/**
 * Approved-only retrieval (P09.09 PILOT, BR-095, ADR-0014).
 *
 * One rule: the assistant reads ONLY servable content — approved, valid,
 * not suspended, not conflicted, channel-allowed. Two surfaces serve it:
 *
 * 1. `knowledge_approved_current` (migration 0061, view v2): the SQL source
 *    of truth for knowledge versions. `readApprovedVersions` reads it back
 *    through the tenant transaction (FORCE RLS on the base tables applies —
 *    the view is security_invoker, no privilege hop).
 * 2. `listCardCatalogue`: the NLU closed-set catalogue — IDs + questions +
 *    variants per channel for every servable faq card (same exclusion
 *    predicate as matchCards: active, unexpired, overdue-sensitive out,
 *    channel-allowed). Deterministic, paginated, no trigram threshold — the
 *    NLU picks among these, never outside them.
 * 3. `findCandidates`: FTS/trigram candidate generation for large catalogues
 *    (> 60 cards): ranked matches above the similarity floor with scores,
 *    same exclusions including the fail-closed location rule. Small
 *    catalogues use listCardCatalogue instead.
 *
 * pgvector HNSW passages are SELL (P09.09.04) — deferred, no code here.
 *
 * Audit: catalogue reads are reads (no audit rows — INV-10 covers business
 * mutations, not reads). Bodies flow to the assistant, never to logs.
 */

import { checkKnowledgeChannel } from './knowledge-channels.ts';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One catalogue entry: what the NLU may select. */
export interface CatalogueCard {
  readonly id: string;
  readonly canonical: string;
  readonly variants: readonly string[];
  readonly sensitivity: string;
}

/** One ranked candidate with its match score. */
export interface RankedCandidate {
  readonly id: string;
  readonly canonical: string;
  readonly score: number;
}

/** Similarity floor for candidate generation (matches matchCards' % operator). */
export const CANDIDATE_SIMILARITY_FLOOR = 0.3;

/**
 * NLU closed-set catalogue: every servable card for the channel —
 * deterministic id order, no scores, no threshold. The NLU selects among
 * these IDs; anything outside is unanswerable by construction.
 */
export async function listCardCatalogue(
  client: TenantClient,
  input: {
    channel?: string | undefined;
    locationId?: string | undefined;
    limit?: number | undefined;
  },
): Promise<readonly CatalogueCard[]> {
  checkKnowledgeChannel(input.channel);
  const limit = input.limit ?? 200;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
    throw new RangeError('limit must be 1..1000');
  }
  const found = await client.query<{
    id: string;
    canonical: string;
    variants: string[];
    sensitivity: string;
  }>(
    `select id::text, canonical, variants, sensitivity from faq_cards
     where organisation_id = app.current_org() and active = true
       and coalesce(valid_until < current_date, false) = false
       and not (sensitivity = 'sensitive'
         and coalesce(updated_at + reverify_after <= now(), false) = true)
       and ($1::uuid is null and location_id is null
            or $1::uuid is not null and (location_id is null or location_id = $1::uuid))
        and ($2::text is null and allowed_channels @> '{call,message,voice,email,web}'
            or $2::text is not null and $2::text = any (allowed_channels))
     order by id limit $3::integer`,
    [input.locationId ?? null, input.channel ?? null, limit],
  );
  return found.rows.map((r) => ({
    id: r.id,
    canonical: r.canonical,
    variants: r.variants,
    sensitivity: r.sensitivity,
  }));
}

/**
 * Ranked trigram candidates for large catalogues: same exclusions as the
 * catalogue (including the fail-closed location rule: omitted locationId
 * returns globally-valid cards ONLY), ordered by similarity score (canonical
 * + best variant). Returns at most `limit` rows above the similarity floor.
 */
export async function findCandidates(
  client: TenantClient,
  input: {
    query: string;
    channel?: string | undefined;
    locationId?: string | undefined;
    limit?: number | undefined;
  },
): Promise<readonly RankedCandidate[]> {
  const trimmed = input.query.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new RangeError('query must be 1..200 characters');
  }
  checkKnowledgeChannel(input.channel);
  if (input.locationId !== undefined && !UUID_RE.test(input.locationId)) {
    throw new RangeError('location id must be a uuid');
  }
  const limit = input.limit ?? 10;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 50) {
    throw new RangeError('limit must be 1..50');
  }
  const found = await client.query<{ id: string; canonical: string; score: number }>(
    `select id::text, canonical,
       greatest(
         similarity(canonical, $1),
         coalesce((select max(similarity(v, $1)) from unnest(variants) v), 0)
       ) as score
     from faq_cards
     where organisation_id = app.current_org() and active = true
       and coalesce(valid_until < current_date, false) = false
       and not (sensitivity = 'sensitive'
         and coalesce(updated_at + reverify_after <= now(), false) = true)
        and ($2::text is null and allowed_channels @> '{call,message,voice,email,web}'
            or $2::text is not null and $2::text = any (allowed_channels))
       and ($3::uuid is null and location_id is null
            or $3::uuid is not null and (location_id is null or location_id = $3::uuid))
       and (canonical % $1 or exists (select 1 from unnest(variants) v where v % $1))
     order by score desc limit $4::integer`,
    [trimmed, input.channel ?? null, input.locationId ?? null, limit],
  );
  return found.rows
    .filter((r) => r.score >= CANDIDATE_SIMILARITY_FLOOR)
    .map((r) => ({ id: r.id, canonical: r.canonical, score: r.score }));
}

/** One approved version row from the retrieval view. */
export interface ApprovedVersion {
  readonly itemId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly title: string;
  readonly body: string;
  readonly sensitivity: string;
  readonly category: string;
}

/**
 * Read servable versions back through the `knowledge_approved_current` view
 * (v2, migration 0061): approved + valid + not suspended + not conflicted +
 * overdue-restricted suppressed. RLS applies through the base tables
 * (security_invoker — no privilege hop), so cross-tenant rows stay hidden.
 * Each read sets transaction-local channel context, including empty for an
 * omitted channel (all five required); no pooled/session-scoped context leaks.
 */
export async function readApprovedVersions(
  client: TenantClient,
  input: {
    category?: string | undefined;
    channel?: string | undefined;
    limit?: number | undefined;
  } = {},
): Promise<readonly ApprovedVersion[]> {
  checkKnowledgeChannel(input.channel);
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new RangeError('limit must be 1..500');
  }
  await client.query(`select set_config('app.knowledge_channel', $1, true)`, [input.channel ?? '']);
  const found = await client.query<{
    item_id: string;
    version_id: string;
    version_no: number;
    title: string;
    body: string;
    sensitivity: string;
    category: string;
  }>(
    `select item_id::text, version_id::text, version_no, title, body, sensitivity, category
     from knowledge_approved_current
     where ($1::text is null or category = $1::text)
     order by item_id limit $2::integer`,
    [input.category ?? null, limit],
  );
  return found.rows.map((r) => ({
    itemId: r.item_id,
    versionId: r.version_id,
    versionNo: r.version_no,
    title: r.title,
    body: r.body,
    sensitivity: r.sensitivity,
    category: r.category,
  }));
}
