/**
 * FAQ cards with approved spoken answers (P09.04, BR-064, T-22, ADR-0014).
 *
 * One row per card: canonical question + match variants + spoken answer (≤ 350,
 * voice-linted) + optional written answer. Staff-direct with optimistic locking
 * (expectedVersion compare-and-bump — profile.ts shape). Retrieval is split by
 * sensitivity at the SERVICE layer (the marker test pins it):
 * - `findAnswer`: trigram match over canonical + variants, returns the SPOKEN
 *   answer verbatim for ANY card (approved-card mode — the default, incl. sensitive).
 * - `groundedCandidates`: same match but EXCLUDES sensitive cards — grounded
 *   generation (P10, per-template ≥ 99 % gate) may only word non-sensitive passages;
 *   sensitive categories (allergens, prices, legal) are approved-card ONLY.
 * Uncertainty always escalates: no match (or only-sensitive-match in grounded mode)
 * returns null — the caller abstains or routes to a human, never a guess (T-22).
 *
 * Spoken lint runs at creation AND update (kernel lintSpokenAnswer): URLs and
 * unreadable digit runs are RangeErrors, never stored. Audit carries sensitivity +
 * version markers only (INV-12): questions and answers never reach audit rows.
 */

import { randomUUID } from 'node:crypto';
import { lintSpokenAnswer } from '@moin/kernel';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

export type FaqSensitivity = 'public' | 'internal' | 'sensitive';

const SENSITIVITY_MARKER: Record<FaqSensitivity, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VARIANTS = 20;

export interface FaqCard {
  readonly id: string;
  readonly canonical: string;
  readonly sensitivity: FaqSensitivity;
  readonly active: boolean;
  readonly version: number;
}

export interface FaqAnswer {
  readonly cardId: string;
  readonly spoken: string;
  readonly sensitivity: FaqSensitivity;
  /** True when the card is past its reverify deadline but still served (P09.06). */
  readonly stale: boolean;
}

interface FaqRow extends Record<string, unknown> {
  id: string;
  canonical: string;
  sensitivity: string;
  spoken_answer: string;
  active: boolean;
  version: string;
}

function toCard(row: FaqRow): FaqCard {
  return {
    id: row.id,
    canonical: row.canonical,
    sensitivity: row.sensitivity as FaqSensitivity,
    active: row.active,
    version: Number(row.version),
  };
}

function checkCanonical(canonical: string): string {
  const trimmed = canonical.trim();
  if (trimmed.length === 0 || trimmed.length > 300) {
    throw new RangeError('canonical question must be 1..300 characters');
  }
  return trimmed;
}

function checkVariants(variants: readonly string[]): string[] {
  if (variants.length > MAX_VARIANTS) {
    throw new RangeError(`at most ${MAX_VARIANTS} variants`);
  }
  return variants.map((v) => {
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > 300) {
      throw new RangeError('variant must be 1..300 characters');
    }
    return trimmed;
  });
}

function checkSpoken(spoken: string): string {
  const lint = lintSpokenAnswer(spoken);
  if (!lint.ok) throw new RangeError(`spoken lint: ${lint.errors.join('; ')}`);
  return spoken.trim();
}

function checkWritten(written: string | undefined): string | null {
  if (written === undefined) return null;
  const trimmed = written.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    throw new RangeError('written answer must be 1..2000 characters');
  }
  return trimmed;
}

function checkSensitivity(sensitivity: string): FaqSensitivity {
  if (sensitivity !== 'public' && sensitivity !== 'internal' && sensitivity !== 'sensitive') {
    throw new RangeError('sensitivity must be public, internal or sensitive');
  }
  return sensitivity;
}

function checkChannels(channels: readonly string[] | undefined): string[] {
  const list = channels ?? ['call', 'message'];
  if (list.length === 0) throw new RangeError('at least one channel required');
  for (const c of list) {
    if (c !== 'call' && c !== 'message') throw new RangeError('channel must be call or message');
  }
  return [...list];
}

export interface FaqInput {
  readonly canonical: string;
  readonly variants?: readonly string[] | undefined;
  readonly spoken: string;
  readonly written?: string | undefined;
  readonly sensitivity?: string | undefined;
  readonly channels?: readonly string[] | undefined;
  readonly locationId?: string | undefined;
  readonly validUntil?: string | undefined;
  /** Re-verification deadline in days (P09.06); null = no deadline. */
  readonly reverifyAfterDays?: number | null | undefined;
}

function checkValidUntil(validUntil: string | undefined): string | null {
  if (validUntil === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(validUntil)) {
    throw new RangeError('valid_until must be YYYY-MM-DD');
  }
  return validUntil;
}

/**
 * Reverify deadline for a card in days (P09.06, ROUND-1 P2-1): omitted
 * (undefined) falls back to the 90-day card default — a card that never goes
 * stale is a card nobody re-checks. Explicit null opts OUT (no deadline).
 * Cards have no menu category, so the single 90d fallback applies (the
 * knowledge menu-30d default lives on versions, not cards — documented here
 * so the asymmetry is deliberate, not an omission).
 */
const FAQ_FALLBACK_DAYS = 90;

function checkReverifyAfterDays(value: number | null | undefined): string | null {
  if (value === undefined) return `${String(FAQ_FALLBACK_DAYS)} days`;
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0 || value > 3650) {
    throw new RangeError('reverify_after must be 1..3650 days');
  }
  return `${String(value)} days`;
}

function checkLocation(locationId: string | undefined): string | null {
  if (locationId === undefined) return null;
  if (!UUID_RE.test(locationId)) throw new RangeError('location id must be a uuid');
  return locationId;
}

/** Create a card (linted; audit markers only). */
export async function createFaqCard(client: TenantClient, input: FaqInput): Promise<FaqCard> {
  const canonical = checkCanonical(input.canonical);
  const variants = checkVariants(input.variants ?? []);
  const spoken = checkSpoken(input.spoken);
  const written = checkWritten(input.written);
  const sensitivity = checkSensitivity(input.sensitivity ?? 'public');
  const channels = checkChannels(input.channels);
  const location = checkLocation(input.locationId);
  const validUntil = checkValidUntil(input.validUntil);
  const reverifyAfter = checkReverifyAfterDays(input.reverifyAfterDays);
  const id = randomUUID();
  const inserted = await client.query<FaqRow>(
    `insert into faq_cards
       (organisation_id, id, canonical, variants, spoken_answer, written_answer,
        sensitivity, allowed_channels, location_id, valid_until, reverify_after)
     values (app.current_org(), $1, $2, $3::text[], $4::text, $5::text, $6::text, $7::text[], $8::uuid,
             $9::date, $10::interval)
     returning id, canonical, sensitivity, spoken_answer, active, version::text`,
    [
      id,
      canonical,
      variants,
      spoken,
      written,
      sensitivity,
      channels,
      location,
      validUntil,
      reverifyAfter,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('faq insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'faq.upsert',
    targetKind: 'faq_card',
    targetId: id,
    argsSanitized: { sensitivity: SENSITIVITY_MARKER[sensitivity], version: 1 },
    result: 'succeeded',
  });
  return toCard(row);
}

/**
 * Update a card (linted; expectedVersion required — no silent unconditional path).
 * Any owner edit re-arms the card (active=true, the re-approval equivalent):
 * a sweep-deactivated card serves again once its content is reviewed, and the
 * updated_at bump restarts the reverify deadline.
 */
export async function updateFaqCard(
  client: TenantClient,
  cardId: string,
  input: FaqInput & { expectedVersion: number },
): Promise<FaqCard> {
  if (!UUID_RE.test(cardId)) throw new RangeError('faq card id must be a uuid');
  const canonical = checkCanonical(input.canonical);
  const variants = checkVariants(input.variants ?? []);
  const spoken = checkSpoken(input.spoken);
  const written = checkWritten(input.written);
  const sensitivity = checkSensitivity(input.sensitivity ?? 'public');
  const channels = checkChannels(input.channels);
  const location = checkLocation(input.locationId);
  const validUntil = checkValidUntil(input.validUntil);
  const reverifyAfter = checkReverifyAfterDays(input.reverifyAfterDays);
  const updated = await client.query<FaqRow>(
    `update faq_cards set canonical = $2::text, variants = $3::text[], spoken_answer = $4::text,
       written_answer = $5::text, sensitivity = $6::text, allowed_channels = $7::text[],
       location_id = $8::uuid, valid_until = $10::date, reverify_after = $11::interval,
       active = true, updated_at = clock_timestamp(), version = version + 1
     where organisation_id = app.current_org() and id = $1 and version = $9::integer
     returning id, canonical, sensitivity, spoken_answer, active, version::text`,
    [
      cardId,
      canonical,
      variants,
      spoken,
      written,
      sensitivity,
      channels,
      location,
      input.expectedVersion,
      validUntil,
      reverifyAfter,
    ],
  );
  const row = updated.rows[0];
  if (row === undefined) throw new VersionConflictError('faq card version mismatch');
  // Re-arm the reverify lifecycle (ROUND-3 P1-1/P1-2, mirrors approval-clears-
  // queue): the reviewed card leaves the sweep's handled set, so the next
  // overdue cycle re-tasks it instead of skipping it silently.
  await client.query(`delete from knowledge_reverify_queue where card_id = $1`, [cardId]);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'faq.upsert',
    targetKind: 'faq_card',
    targetId: cardId,
    argsSanitized: { sensitivity: SENSITIVITY_MARKER[sensitivity], version: Number(row.version) },
    result: 'succeeded',
  });
  return toCard(row);
}

/** Deactivate a card (version-locked; retired cards never match). */
export async function deactivateFaqCard(
  client: TenantClient,
  cardId: string,
  expectedVersion: number,
): Promise<void> {
  if (!UUID_RE.test(cardId)) throw new RangeError('faq card id must be a uuid');
  const done = await client.query(
    `update faq_cards set active = false, updated_at = clock_timestamp(), version = version + 1
     where organisation_id = app.current_org() and id = $1 and version = $2::integer
     returning sensitivity, version::text as version`,
    [cardId, expectedVersion],
  );
  const row = (done.rows as { sensitivity: string; version: string }[])[0];
  if (row === undefined) throw new VersionConflictError('faq card version mismatch');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'faq.upsert',
    targetKind: 'faq_card',
    targetId: cardId,
    argsSanitized: {
      sensitivity: SENSITIVITY_MARKER[row.sensitivity as FaqSensitivity],
      version: Number(row.version),
    },
    result: 'succeeded',
  });
}

interface MatchRow extends Record<string, unknown> {
  id: string;
  spoken_answer: string;
  sensitivity: string;
  score: number;
  stale: boolean;
}

export interface FaqQuery {
  readonly query: string;
  readonly locationId?: string | undefined;
  readonly channel?: string | undefined;
}

async function matchCards(
  client: TenantClient,
  input: FaqQuery,
  excludeSensitive: boolean,
): Promise<readonly FaqAnswer[]> {
  const trimmed = input.query.trim();
  if (trimmed.length === 0 || trimmed.length > 200)
    throw new RangeError('query must be 1..200 characters');
  // Fail-CLOSED defaults: an unfiltered call returns globally-valid cards ONLY.
  // No locationId → location_id IS NULL required (location-specific cards need
  // their location named). No channel → the card must serve BOTH channels (a
  // message-only card must not speak on a voice call the caller never named).
  const location =
    input.locationId === undefined
      ? null
      : UUID_RE.test(input.locationId)
        ? input.locationId
        : (() => {
            throw new RangeError('location id must be a uuid');
          })();
  if (input.channel !== undefined && input.channel !== 'call' && input.channel !== 'message') {
    throw new RangeError('channel must be call or message');
  }
  const found = await client.query<MatchRow>(
    `select id::text, spoken_answer, sensitivity,
       greatest(
         similarity(canonical, $1),
         coalesce((select max(similarity(v, $1)) from unnest(variants) v), 0)
       ) as score,
       coalesce(updated_at + reverify_after <= now(), false) as stale
     from faq_cards
     where organisation_id = app.current_org() and active = true
       and coalesce(valid_until < current_date, false) = false
       -- Overdue sensitive cards stop serving (escalation, same rule as
       -- knowledge restricted — ROUND-1 P1-3); overdue public/internal serve
       -- flagged stale.
       and not (sensitivity = 'sensitive'
         and coalesce(updated_at + reverify_after <= now(), false) = true)
       and ($2::boolean = false or sensitivity <> 'sensitive')
       and ($3::uuid is null and location_id is null
            or $3::uuid is not null and (location_id is null or location_id = $3::uuid))
       and ($4::text is null and allowed_channels @> '{call,message}'
            or $4::text is not null and $4::text = any (allowed_channels))
       and (canonical % $1 or exists (select 1 from unnest(variants) v where v % $1))
     order by score desc limit 3`,
    [trimmed, excludeSensitive, location, input.channel ?? null],
  );
  return found.rows.map((r) => ({
    cardId: r.id,
    spoken: r.spoken_answer,
    sensitivity: r.sensitivity as FaqSensitivity,
    stale: r.stale,
  }));
}

/**
 * Approved-card lookup (the DEFAULT answer mode, ADR-0014): trigram match over
 * canonical + variants, spoken answer verbatim — sensitive cards INCLUDED (this is
 * their only mode). Null when nothing matches: the caller abstains or escalates.
 * Expired cards never match (P09.06.01); overdue sensitive cards never match
 * (escalation); overdue public/internal match with stale=true.
 */
export async function findAnswer(
  client: TenantClient,
  query: string | FaqQuery,
): Promise<FaqAnswer | null> {
  const hits = await matchCards(client, typeof query === 'string' ? { query } : query, false);
  return hits[0] ?? null;
}

/**
 * Grounded-generation candidates (P10, gated per template): same match but sensitive
 * cards EXCLUDED — grounded wording may only use non-sensitive passages. Null-heavy:
 * a query matching ONLY sensitive cards yields [] here (while findAnswer answers).
 */
export async function groundedCandidates(
  client: TenantClient,
  query: string | FaqQuery,
): Promise<readonly FaqAnswer[]> {
  return matchCards(client, typeof query === 'string' ? { query } : query, true);
}
