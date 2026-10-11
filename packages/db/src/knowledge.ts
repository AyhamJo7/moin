/**
 * Knowledge model, lifecycle and versions (P09.01, BR-095).
 *
 * One governed source of approved business truth per tenant: the item shell carries
 * lifecycle state + the live-version pointer, `knowledge_versions` is history with one
 * permitted write (the draft→approved flip, guarded so an approved row never matches
 * again), and `knowledge_approvals` records who approved which version when.
 *
 * Lifecycle: Draft → Approved → Retired. Creating makes item (draft) + version 1
 * (draft); nothing is served until approval (live pointer NULL). Editing an APPROVED
 * item inserts a new draft version — the approved version STAYS LIVE until the new
 * one is approved (P09.01.02). Approving moves the live pointer + writes the approval
 * row atomically under the item lock. Retiring clears the live pointer (retired items
 * are never served) and is terminal. Concurrent approves/retires serialise on the
 * item FOR UPDATE lock; the loser finds no draft / an already-terminal state and 409s.
 *
 * Serving (`getLiveVersion`): reads the item's live pointer. Draft items (NULL) and
 * retired items (cleared) serve nothing — never a draft body, never a retired one.
 *
 * Every mutation audits with markers only (INV-12): version numbers and state names,
 * never titles or bodies. Bodies are spoken verbatim downstream (ADR-0014) but never
 * reach audit, logs or metrics here.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { currentTenant, type TenantClient } from './tenant.ts';

export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

export type KnowledgeState = 'draft' | 'approved' | 'retired';
export type KnowledgeSource = 'website' | 'pdf' | 'manual' | 'import';
export type KnowledgeSensitivity = 'public' | 'internal' | 'restricted';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface KnowledgeMetadata {
  readonly source: KnowledgeSource;
  readonly locationId?: string | undefined;
  readonly category: string;
  readonly validFrom?: string | undefined;
  readonly validUntil?: string | undefined;
  readonly sensitivity?: KnowledgeSensitivity | undefined;
  readonly allowedChannels?: readonly string[] | undefined;
  /** Re-verification deadline in days. Defaults per category (P09.06); null = no deadline. */
  readonly reverifyAfterDays?: number | null | undefined;
}

export interface KnowledgeItem {
  readonly id: string;
  readonly state: KnowledgeState;
  readonly liveVersionId: string | null;
  readonly version: number;
}

export interface KnowledgeVersion {
  readonly id: string;
  readonly itemId: string;
  readonly versionNo: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'draft' | 'approved';
}

interface ItemRow extends Record<string, unknown> {
  id: string;
  state: string;
  live_version_id: string | null;
  version: string;
}

interface VersionRow extends Record<string, unknown> {
  id: string;
  item_id: string;
  version_no: string;
  title: string;
  body: string;
  state: string;
}

function toItem(row: ItemRow): KnowledgeItem {
  return {
    id: row.id,
    state: row.state as KnowledgeState,
    liveVersionId: row.live_version_id,
    version: Number(row.version),
  };
}

function toVersion(row: VersionRow): KnowledgeVersion {
  return {
    id: row.id,
    itemId: row.item_id,
    versionNo: Number(row.version_no),
    title: row.title,
    body: row.body,
    state: row.state as 'draft' | 'approved',
  };
}

function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new RangeError('knowledge title must be 1..200 characters');
  }
  return trimmed;
}

function checkBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 8000) {
    throw new RangeError('knowledge body must be 1..8000 characters');
  }
  return trimmed;
}

function checkCategory(category: string): string {
  const trimmed = category.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new RangeError('knowledge category must be 1..80 characters');
  }
  return trimmed;
}

/** Per-category reverify defaults in days (PLAN P09.06.01). Single home. */
const REVERIFY_DEFAULT_DAYS: Readonly<Record<string, number>> = {
  menu: 30,
  hours: 90,
  prices: 90,
};

const REVERIFY_FALLBACK_DAYS = 90;

/** Days until re-verification is due for a category (PLAN P09.06.01). */
export function reverifyDaysForCategory(category: string): number {
  return REVERIFY_DEFAULT_DAYS[category.trim().toLowerCase()] ?? REVERIFY_FALLBACK_DAYS;
}

function checkReverifyAfter(value: number | null | undefined, category: string): number | null {
  if (value === undefined) return reverifyDaysForCategory(category);
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0 || value > 3650) {
    throw new RangeError('reverify_after must be 1..3650 days');
  }
  return value;
}

function checkMetadata(input: KnowledgeMetadata): {
  source: KnowledgeSource;
  locationId: string | null;
  category: string;
  validFrom: string | null;
  validUntil: string | null;
  sensitivity: KnowledgeSensitivity;
  channels: readonly string[];
  reverifyAfter: string | null;
} {
  if (input.locationId !== undefined && !UUID_RE.test(input.locationId)) {
    throw new RangeError('location id must be a uuid');
  }
  const category = checkCategory(input.category);
  const validFrom = input.validFrom ?? null;
  const validUntil = input.validUntil ?? null;
  if (validFrom !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(validFrom)) {
    throw new RangeError('valid_from must be YYYY-MM-DD');
  }
  if (validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(validUntil)) {
    throw new RangeError('valid_until must be YYYY-MM-DD');
  }
  if (validFrom !== null && validUntil !== null && validFrom > validUntil) {
    throw new RangeError('valid_from must not be after valid_until');
  }
  const channels = input.allowedChannels ?? ['call', 'message'];
  for (const channel of channels) {
    if (channel !== 'call' && channel !== 'message') {
      throw new RangeError('allowed channel must be call or message');
    }
  }
  if (channels.length === 0) throw new RangeError('at least one channel required');
  // Reverify deadline (P09.06): explicit days beat the category default; null
  // stays null (no deadline, e.g. pre-0057 rows). Stored as a Postgres interval
  // so deadline math (`decided_at + reverify_after`) stays in SQL.
  const reverifyDays = checkReverifyAfter(input.reverifyAfterDays, category);
  return {
    source: input.source,
    locationId: input.locationId ?? null,
    category,
    validFrom,
    validUntil,
    sensitivity: input.sensitivity ?? 'public',
    channels,
    reverifyAfter: reverifyDays === null ? null : `${String(reverifyDays)} days`,
  };
}

async function lockItem(client: TenantClient, itemId: string): Promise<ItemRow> {
  if (!UUID_RE.test(itemId)) throw new RangeError('knowledge item id must be a uuid');
  const found = await client.query<ItemRow>(
    `select id, state, live_version_id::text, version::text from knowledge_items
     where id = $1 for update`,
    [itemId],
  );
  const row = found.rows[0];
  if (row === undefined) throw new VersionConflictError('knowledge item not found');
  return row;
}

/**
 * Create a knowledge item with its first draft version. Nothing is served until
 * approval — the live pointer starts NULL.
 */
export async function createKnowledgeItem(
  client: TenantClient,
  input: { title: string; body: string; metadata: KnowledgeMetadata },
): Promise<{ item: KnowledgeItem; version: KnowledgeVersion }> {
  const title = checkTitle(input.title);
  const body = checkBody(input.body);
  const meta = checkMetadata(input.metadata);
  const itemId = randomUUID();
  const versionId = randomUUID();
  await client.query(
    `insert into knowledge_items (organisation_id, id) values (app.current_org(), $1)`,
    [itemId],
  );
  const version = await client.query<VersionRow>(
    `insert into knowledge_versions
       (organisation_id, id, item_id, version_no, title, body, source, location_id,
        category, valid_from, valid_until, sensitivity, allowed_channels, reverify_after)
     values (app.current_org(), $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::interval)
     returning id, item_id, version_no, title, body, state`,
    [
      versionId,
      itemId,
      title,
      body,
      meta.source,
      meta.locationId,
      meta.category,
      meta.validFrom,
      meta.validUntil,
      meta.sensitivity,
      meta.channels,
      meta.reverifyAfter,
    ],
  );
  const versionRow = version.rows[0];
  if (versionRow === undefined) throw new Error('knowledge version insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.create',
    targetKind: 'knowledge_item',
    targetId: itemId,
    argsSanitized: { version_no: 1 },
    result: 'succeeded',
  });
  const item = await client.query<ItemRow>(
    `select id, state, live_version_id::text, version::text from knowledge_items where id = $1`,
    [itemId],
  );
  const itemRow = item.rows[0];
  if (itemRow === undefined) throw new Error('knowledge item insert returned no row');
  return { item: toItem(itemRow), version: toVersion(versionRow) };
}

/**
 * Edit an item: inserts a NEW draft version, never touches existing rows. When the item
 * is approved, the live version stays live — the new draft goes live only on approval
 * (P09.01.02). Editing a retired item is refused (terminal).
 */
export async function editKnowledgeItem(
  client: TenantClient,
  itemId: string,
  input: { title: string; body: string; metadata: KnowledgeMetadata },
): Promise<KnowledgeVersion> {
  const row = await lockItem(client, itemId);
  if (row.state === 'retired') throw new VersionConflictError('knowledge item is retired');
  const title = checkTitle(input.title);
  const body = checkBody(input.body);
  const meta = checkMetadata(input.metadata);
  const next = await client.query<{ n: number }>(
    `select coalesce(max(version_no), 0) + 1 as n from knowledge_versions where item_id = $1`,
    [itemId],
  );
  const versionNo = next.rows[0]?.n ?? 1;
  const versionId = randomUUID();
  const inserted = await client.query<VersionRow>(
    `insert into knowledge_versions
       (organisation_id, id, item_id, version_no, title, body, source, location_id,
        category, valid_from, valid_until, sensitivity, allowed_channels, reverify_after)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::interval)
     returning id, item_id, version_no, title, body, state`,
    [
      versionId,
      itemId,
      versionNo,
      title,
      body,
      meta.source,
      meta.locationId,
      meta.category,
      meta.validFrom,
      meta.validUntil,
      meta.sensitivity,
      meta.channels,
      meta.reverifyAfter,
    ],
  );
  const versionRow = inserted.rows[0];
  if (versionRow === undefined) throw new Error('knowledge version insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.edit',
    targetKind: 'knowledge_item',
    targetId: itemId,
    argsSanitized: { version_no: versionNo },
    result: 'succeeded',
  });
  return toVersion(versionRow);
}

/**
 * Approve a draft version through the DEFINER door: calls
 * `app.approve_knowledge_version(item, version, actor)` — the actor comes from
 * the TenantClient context (`currentTenant().actorId`, SET by withTenant from
 * the session, INV-02: never caller input above the service). Item lock +
 * latest-draft check + role gate + hash + ledger + flip + pointer, atomically,
 * as owner — then audits (markers only) in the same txn. Pre-checks run first so
 * failures 409/403 (not raw DEFINER exceptions): retired items, non-draft or stale
 * versions. No approvedBy param (P09.05 identity fix): nominating another user's
 * UUID is inexpressible — the txn actor IS the approver, bound here.
 */
export async function approveKnowledgeVersion(
  client: TenantClient,
  input: { itemId: string; versionId: string },
): Promise<KnowledgeItem> {
  if (!UUID_RE.test(input.versionId)) throw new RangeError('knowledge version id must be a uuid');
  // Actor bound HERE from session context (INV-02) — the fn's p_actor arg
  // carries this value, never caller input. Direct SQL callers bypass this
  // binding (privileged-role surface, same as every DEFINER — see 0056 header).
  const actor = currentTenant()?.actorId ?? null;
  if (actor === null || !UUID_RE.test(actor)) {
    throw new VersionConflictError('knowledge approval requires an acting user');
  }
  const row = await lockItem(client, input.itemId);
  if (row.state === 'retired') throw new VersionConflictError('knowledge item is retired');
  // Pre-checks BEFORE the DEFINER call (the fn raises 22023 on the same
  // conditions — the service maps everything to 409 so callers never see
  // raw DB exceptions): the target must be a draft of THIS item AND the latest
  // version_no (latest check + item lock in the same txn: a concurrent newer draft
  // lands first and this 409s).
  const candidate = await client.query<{ state: string; latest: boolean }>(
    `select state, (version_no = (select max(version_no) from knowledge_versions
       where item_id = $2)) as latest
     from knowledge_versions where id = $1 and item_id = $2`,
    [input.versionId, input.itemId],
  );
  const found = candidate.rows[0];
  if (found?.state !== 'draft' || !found.latest) {
    throw new VersionConflictError('knowledge version is not the latest approvable draft');
  }
  // The single publish door: ledger + flip + pointer, atomically, as owner. Direct
  // SQL cannot publish (no UPDATE on versions, no INSERT on approvals — 42501).
  await client.query(`select app.approve_knowledge_version($1, $2, $3::uuid)`, [
    input.itemId,
    input.versionId,
    actor,
  ]);
  const item = await client.query<ItemRow>(
    `select id, state, live_version_id::text, version::text from knowledge_items where id = $1`,
    [input.itemId],
  );
  const itemRow = item.rows[0];
  if (itemRow === undefined) throw new Error('knowledge item update returned no row');
  // Re-approval lifts the suspension (P09.06.02): a suspended item that passes
  // review serves again — the new approval is the review.
  await client.query(`update knowledge_items set suspended = false where id = $1`, [input.itemId]);
  const versionNo = await client.query<{ n: number }>(
    `select version_no as n from knowledge_versions where id = $1`,
    [input.versionId],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.approve',
    targetKind: 'knowledge_item',
    targetId: input.itemId,
    argsSanitized: { version_no: versionNo.rows[0]?.n ?? 0 },
    result: 'succeeded',
  });
  return toItem(itemRow);
}

/**
 * Retire an item: clears the live pointer (retired items are never served) and moves
 * the shell to retired. Terminal — no transition out. Concurrent retires serialise on
 * the item lock; the loser finds retired and 409s.
 */
export async function retireKnowledgeItem(
  client: TenantClient,
  itemId: string,
): Promise<KnowledgeItem> {
  const row = await lockItem(client, itemId);
  if (row.state === 'retired') throw new VersionConflictError('knowledge item is already retired');
  const moved = await client.query<ItemRow>(
    `update knowledge_items set state = 'retired', live_version_id = null,
       updated_at = clock_timestamp(), version = version + 1
     where id = $1 and state <> 'retired'
     returning id, state, live_version_id::text, version::text`,
    [itemId],
  );
  const itemRow = moved.rows[0];
  if (itemRow === undefined) throw new VersionConflictError('knowledge item is already retired');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.retire',
    targetKind: 'knowledge_item',
    targetId: itemId,
    argsSanitized: { scope: 1 },
    result: 'succeeded',
  });
  return toItem(itemRow);
}

/**
 * The currently served version: the item's live pointer, or null when nothing is live
 * (draft items before first approval, retired items always). Only approved versions
 * are ever reachable through this path — drafts are invisible to serving.
 *
 * P09.06 validity: expired live versions (valid_until < today) serve nothing —
 * expiry is absolute, regardless of sensitivity or verification age. Suspended
 * items (overdue restricted, P09.06.02) serve nothing until re-approved.
 */
export async function getLiveVersion(
  client: TenantClient,
  itemId: string,
): Promise<KnowledgeVersion | null> {
  if (!UUID_RE.test(itemId)) throw new RangeError('knowledge item id must be a uuid');
  const found = await client.query<VersionRow>(
    `select v.id, v.item_id, v.version_no, v.title, v.body, v.state
     from knowledge_versions v join knowledge_items i
       on i.organisation_id = v.organisation_id and i.id = v.item_id
     where i.id = $1 and v.id = i.live_version_id and v.state = 'approved'
       and i.state = 'approved' and not i.suspended
       and coalesce(v.valid_until < current_date, false) = false`,
    [itemId],
  );
  const row = found.rows[0];
  return row === undefined ? null : toVersion(row);
}
