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
import type { TenantClient } from './tenant.ts';

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

function checkMetadata(input: KnowledgeMetadata): {
  source: KnowledgeSource;
  locationId: string | null;
  category: string;
  validFrom: string | null;
  validUntil: string | null;
  sensitivity: KnowledgeSensitivity;
  channels: readonly string[];
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
  return {
    source: input.source,
    locationId: input.locationId ?? null,
    category,
    validFrom,
    validUntil,
    sensitivity: input.sensitivity ?? 'public',
    channels,
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
        category, valid_from, valid_until, sensitivity, allowed_channels)
     values (app.current_org(), $1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        category, valid_from, valid_until, sensitivity, allowed_channels)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
 * Approve a draft version: writes the approval ledger row FIRST, then flips the
 * version row to approved, then moves the item's live pointer — atomically under the
 * item lock. Order matters: the versions trigger requires the ledger row to exist
 * before it allows the flip, so publishing without a named approver dies at the DB
 * boundary even for direct SQL. The version must belong to this item, still be draft,
 * AND be the latest version_no (stale drafts never go live — P09.05.03
 * re-verification approves the newest text, not an older draft superseded while it
 * waited). Concurrent approves serialise on the item lock; the loser finds no
 * matching draft and 409s.
 */
export async function approveKnowledgeVersion(
  client: TenantClient,
  input: { itemId: string; versionId: string; approvedBy: string },
): Promise<KnowledgeItem> {
  if (!UUID_RE.test(input.versionId)) throw new RangeError('knowledge version id must be a uuid');
  if (!UUID_RE.test(input.approvedBy)) throw new RangeError('approver must be a user id');
  const row = await lockItem(client, input.itemId);
  if (row.state === 'retired') throw new VersionConflictError('knowledge item is retired');
  // Pre-checks BEFORE the ledger insert (ledger-first would turn every re-approval
  // into a 23505 instead of a 409, and leave a stray approval row behind on failure):
  // the target must be a draft of THIS item AND the latest version_no (latest check +
  // item lock in the same txn: a concurrent newer draft lands first and this 409s).
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
  // Ledger FIRST: the versions trigger requires this row before it allows the flip.
  // A version row's single draft→approved transition is its only write — the trigger
  // rejects every other UPDATE shape at the DB boundary.
  await client.query(
    `insert into knowledge_approvals (organisation_id, id, item_id, version_id, approved_by)
     values (app.current_org(), $1, $2, $3, $4)`,
    [randomUUID(), input.itemId, input.versionId, input.approvedBy],
  );
  const flipped = await client.query<{ id: string }>(
    `update knowledge_versions set state = 'approved' where id = $1 and item_id = $2
       and state = 'draft'
       and version_no = (select max(version_no) from knowledge_versions where item_id = $2)
     returning id::text`,
    [input.versionId, input.itemId],
  );
  if (flipped.rows[0] === undefined) {
    throw new VersionConflictError('knowledge version is not the latest approvable draft');
  }
  const moved = await client.query<ItemRow>(
    `update knowledge_items set state = 'approved', live_version_id = $1,
       updated_at = clock_timestamp(), version = version + 1
     where id = $2 returning id, state, live_version_id::text, version::text`,
    [input.versionId, input.itemId],
  );
  const itemRow = moved.rows[0];
  if (itemRow === undefined) throw new Error('knowledge item update returned no row');
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
     where i.id = $1 and v.id = i.live_version_id and v.state = 'approved'`,
    [itemId],
  );
  const row = found.rows[0];
  return row === undefined ? null : toVersion(row);
}
