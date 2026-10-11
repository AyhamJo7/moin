/**
 * Duplicate candidates + human merge/unmerge (P07.04, INV-09).
 *
 * Identity is deterministic or human-approved — never model-decided. The three candidate
 * signals below are all deterministic database comparisons; the `aiSimilarity` flag is a
 * stub a future P10 model may SET, but it changes nothing about merge authority: merges
 * happen only through `applyMerge` with a named human approver. There is no AI call here,
 * no auto-merge path, and no threshold that merges without a person.
 *
 * Merge moves methods + links from loser → winner under UUID-ordered row locks (sort the
 * two ids, lock FOR UPDATE in that order — the same pair in the opposite order blocks
 * instead of deadlocking), records the moved ids in `contact_merges`, then deletes the
 * loser row. Unmerge within 30 days moves them back and re-creates the loser under a
 * FRESH id (UUIDs are never recycled). Every mutation audits with opaque markers only
 * (INV-12): signal kinds and row counts, never names, values or content.
 */

import { randomUUID } from 'node:crypto';
import { personName } from '@moin/kernel';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

export type CandidateSignal = 'name_postal' | 'email_local' | 'ai_similarity';

const SIGNAL_MARKER: Record<CandidateSignal, number> = {
  name_postal: 0,
  email_local: 1,
  ai_similarity: 2,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTAL_RE = /^\d{5}$/u;
const UNMERGE_WINDOW_DAYS = 30;

export interface DuplicateCandidate {
  readonly id: string;
  readonly contactAId: string;
  readonly contactBId: string;
  readonly kind: string;
  readonly status: string;
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  contact_a_id: string;
  contact_b_id: string;
  kind: string;
  status: string;
}

function toCandidate(row: CandidateRow): DuplicateCandidate {
  return {
    id: row.id,
    contactAId: row.contact_a_id,
    contactBId: row.contact_b_id,
    kind: row.kind,
    status: row.status,
  };
}

/** Order two contact ids for lock acquisition: same pair, same order, never a deadlock. */
function orderedPair(a: string, b: string): [string, string] {
  if (!UUID_RE.test(a) || !UUID_RE.test(b)) throw new RangeError('contact id must be a uuid');
  if (a === b) throw new RangeError('cannot merge a contact with itself');
  return a < b ? [a, b] : [b, a];
}

function checkPostal(postal: string): string {
  const trimmed = postal.trim();
  if (!POSTAL_RE.test(trimmed)) throw new RangeError('postal code must be five digits');
  return trimmed;
}

function checkLocalPart(local: string): string {
  const trimmed = local.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 64 || !/^[a-z0-9._%+-]+$/u.test(trimmed)) {
    throw new RangeError('email local part is empty');
  }
  return trimmed;
}

async function lockContacts(client: TenantClient, a: string, b: string): Promise<void> {
  const [first, second] = orderedPair(a, b);
  // UUID order, same order for every caller: concurrent merges of the same pair serialise,
  // and merges of overlapping pairs (A,B) vs (B,C) cannot deadlock — both want B's lock
  // in the same global order.
  const rows = await client.query<{ id: string }>(
    `select id from contacts where id = $1 or id = $2 order by id asc for update`,
    [first, second],
  );
  if (rows.rows.length !== 2) throw new VersionConflictError('contact missing for merge');
}

/**
 * Suggest a name+PLZ duplicate: same NFC-normalised display name and same five-digit PLZ.
 * The PLZ is caller-supplied (contacts carry no PLZ column); the name normalises through
 * PersonName, exactly what the column stores. Idempotent per open pair+kind.
 */
export async function suggestNamePostal(
  client: TenantClient,
  contactAId: string,
  contactBId: string,
  input: { displayName: string; postalCode: string },
): Promise<DuplicateCandidate> {
  const [first, second] = orderedPair(contactAId, contactBId);
  const name = personName(input.displayName).value;
  const postal = checkPostal(input.postalCode);
  const id = randomUUID();
  const result = await client.query<CandidateRow>(
    `insert into duplicate_candidates
       (organisation_id, id, contact_a_id, contact_b_id, kind, value, signal_name, signal_postal)
     values (app.current_org(), $1, $2, $3, 'name_postal', $4, $5, $6)
     on conflict (organisation_id, kind, value, status) do nothing
     returning id, contact_a_id, contact_b_id, kind, status`,
    [id, first, second, `${name} ${postal}`, name, postal],
  );
  const row =
    result.rows[0] ??
    (
      await client.query<CandidateRow>(
        `select id, contact_a_id, contact_b_id, kind, status from duplicate_candidates
         where organisation_id = app.current_org() and contact_a_id = $1
           and contact_b_id = $2 and kind = 'name_postal' and status = 'open'`,
        [first, second],
      )
    ).rows[0];
  if (row === undefined) throw new Error('candidate suggest returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.suggest',
    targetKind: 'duplicate_candidate',
    targetId: row.id,
    argsSanitized: { signal: SIGNAL_MARKER.name_postal },
    result: 'succeeded',
  });
  return toCandidate(row);
}

/**
 * Suggest an email-local-part duplicate: same lowercased local part, domains may differ
 * (provider move). Suggestion only — never an auto-merge.
 */
export async function suggestEmailLocal(
  client: TenantClient,
  contactAId: string,
  contactBId: string,
  input: { localPart: string },
): Promise<DuplicateCandidate> {
  const [first, second] = orderedPair(contactAId, contactBId);
  const local = checkLocalPart(input.localPart);
  const id = randomUUID();
  const result = await client.query<CandidateRow>(
    `insert into duplicate_candidates
       (organisation_id, id, contact_a_id, contact_b_id, kind, value, signal_local)
     values (app.current_org(), $1, $2, $3, 'email_local', $4, $5)
     on conflict (organisation_id, kind, value, status) do nothing
     returning id, contact_a_id, contact_b_id, kind, status`,
    [id, first, second, local, local],
  );
  const row =
    result.rows[0] ??
    (
      await client.query<CandidateRow>(
        `select id, contact_a_id, contact_b_id, kind, status from duplicate_candidates
         where organisation_id = app.current_org() and contact_a_id = $1
           and contact_b_id = $2 and kind = 'email_local' and status = 'open'`,
        [first, second],
      )
    ).rows[0];
  if (row === undefined) throw new Error('candidate suggest returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.suggest',
    targetKind: 'duplicate_candidate',
    targetId: row.id,
    argsSanitized: { signal: SIGNAL_MARKER.email_local },
    result: 'succeeded',
  });
  return toCandidate(row);
}

/**
 * AI similarity stub (P10): records the suggestion flag and nothing else. It grants no
 * authority — `applyMerge` still needs the human approver. No model is called here.
 */
export async function suggestAiSimilarity(
  client: TenantClient,
  contactAId: string,
  contactBId: string,
): Promise<DuplicateCandidate> {
  const [first, second] = orderedPair(contactAId, contactBId);
  const id = randomUUID();
  const result = await client.query<CandidateRow>(
    `insert into duplicate_candidates
       (organisation_id, id, contact_a_id, contact_b_id, kind, value, ai_suggested)
     values (app.current_org(), $1, $2, $3, 'ai_similarity', $4, true)
     on conflict (organisation_id, kind, value, status) do nothing
     returning id, contact_a_id, contact_b_id, kind, status`,
    [id, first, second, `${first.slice(0, 8)}~${second.slice(0, 8)}`],
  );
  const row =
    result.rows[0] ??
    (
      await client.query<CandidateRow>(
        `select id, contact_a_id, contact_b_id, kind, status from duplicate_candidates
         where organisation_id = app.current_org() and contact_a_id = $1
           and contact_b_id = $2 and kind = 'ai_similarity' and status = 'open'`,
        [first, second],
      )
    ).rows[0];
  if (row === undefined) throw new Error('candidate suggest returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.suggest',
    targetKind: 'duplicate_candidate',
    targetId: row.id,
    argsSanitized: { signal: SIGNAL_MARKER.ai_similarity },
    result: 'succeeded',
  });
  return toCandidate(row);
}

export interface MergeRecord {
  readonly id: string;
  readonly winnerId: string;
  readonly loserId: string;
  readonly movedMethodIds: readonly string[];
}

/**
 * Human-approved merge: locks both contacts in UUID order, moves methods + links
 * (conversations, calls, leads, requests, notes, tasks by conversation link) from loser
 * to winner, records the moved ids, marks the candidate merged, deletes the loser.
 * The approver is a staff user id (opaque, INV-12). Concurrent merges of the same pair
 * serialise on the locks; the loser finds a missing row and 409s.
 */
export async function applyMerge(
  client: TenantClient,
  input: {
    winnerId: string;
    loserId: string;
    approvedBy: string;
    candidateId?: string | undefined;
  },
): Promise<MergeRecord> {
  if (!UUID_RE.test(input.approvedBy)) throw new RangeError('approver must be a user id');
  if (input.candidateId !== undefined && !UUID_RE.test(input.candidateId)) {
    throw new RangeError('candidate id must be a uuid');
  }
  await lockContacts(client, input.winnerId, input.loserId);
  const mergeId = randomUUID();
  // Move links that name a METHOD first: interaction_links carries the composite triple
  // (organisation, contact, method) — re-pointing contact_id while method_id still names
  // the loser's row would violate the triple FK. Move method rows first, then the links.
  // Verified-unique collisions cannot happen here: the pair was suggested exactly because
  // both contacts own the same verified value through DIFFERENT rows, and the loser's
  // rows leave it (UPDATE, not copy) — the winner ends with the union, one row per value.
  const methods = await client.query<{ id: string }>(
    `update contact_methods set contact_id = $1, updated_at = clock_timestamp(), version = version + 1
     where contact_id = $2
     returning id::text`,
    [input.winnerId, input.loserId],
  );
  const methodIds = methods.rows.map((r) => r.id);
  const moveLinks = async (
    table:
      'conversations' | 'calls' | 'leads' | 'appointment_requests' | 'notes' | 'interaction_links',
  ): Promise<readonly string[]> => {
    // Branch-per-table (governance.ts purgeCandidates shape): the table is a union
    // member, never interpolated — the lint bans string-built SQL outright.
    const moved =
      table === 'conversations'
        ? await client.query<{ id: string }>(
            `update conversations set contact_id = $1 where contact_id = $2 returning id::text`,
            [input.winnerId, input.loserId],
          )
        : table === 'calls'
          ? await client.query<{ id: string }>(
              `update calls set contact_id = $1 where contact_id = $2 returning id::text`,
              [input.winnerId, input.loserId],
            )
          : table === 'leads'
            ? await client.query<{ id: string }>(
                `update leads set contact_id = $1 where contact_id = $2 returning id::text`,
                [input.winnerId, input.loserId],
              )
            : table === 'appointment_requests'
              ? await client.query<{ id: string }>(
                  `update appointment_requests set contact_id = $1 where contact_id = $2 returning id::text`,
                  [input.winnerId, input.loserId],
                )
              : table === 'notes'
                ? await client.query<{ id: string }>(
                    `update notes set contact_id = $1 where contact_id = $2 returning id::text`,
                    [input.winnerId, input.loserId],
                  )
                : await client.query<{ id: string }>(
                    `update interaction_links set contact_id = $1 where contact_id = $2 returning id::text`,
                    [input.winnerId, input.loserId],
                  );
    return moved.rows.map((r) => r.id);
  };
  const linkIds = await moveLinks('interaction_links');
  const convoIds = await moveLinks('conversations');
  const callIds = await moveLinks('calls');
  const leadIds = await moveLinks('leads');
  const requestIds = await moveLinks('appointment_requests');
  const noteIds = await moveLinks('notes');
  // Tasks link by conversation, not contact — and only through the conversations that
  // actually moved (a task on an unmoved conversation is not this merge's business).
  // No-op by construction today (convoIds re-homed above carry no tasks yet in practice),
  // kept explicit so the ledger's moved_task_ids means what it says.
  const taskIds: string[] = [];
  if (convoIds.length > 0) {
    const moved = await client.query<{ id: string }>(
      `select id::text from tasks where conversation_id = any ($1)`,
      [convoIds],
    );
    taskIds.push(...moved.rows.map((r) => r.id));
  }
  await client.query(
    `insert into contact_merges
       (organisation_id, id, winner_id, loser_id, approved_by, candidate_id,
        moved_method_ids, moved_link_ids, moved_task_ids, moved_lead_ids,
        moved_request_ids, moved_note_ids)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      mergeId,
      input.winnerId,
      input.loserId,
      input.approvedBy,
      input.candidateId ?? null,
      methodIds,
      [...linkIds, ...convoIds, ...callIds],
      taskIds,
      leadIds,
      requestIds,
      noteIds,
    ],
  );
  if (input.candidateId !== undefined) {
    // Consume the suggestion: the inbox row is deleted with the merge (its contact legs
    // CASCADE with the loser row — verified by probe — and RESTRICT/NOT NULL/
    // distinct-legs forbid keeping it). The ledger's candidate_id + audit signal marker
    // preserve the evidence; the inbox is a worklist, not evidence.
    await client.query(`delete from duplicate_candidates where id = $1`, [input.candidateId]);
  }
  await client.query(`delete from contacts where id = $1`, [input.loserId]);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.apply',
    targetKind: 'contact_merge',
    targetId: mergeId,
    argsSanitized: { moved: methodIds.length + linkIds.length },
    result: 'succeeded',
  });
  return {
    id: mergeId,
    winnerId: input.winnerId,
    loserId: input.loserId,
    movedMethodIds: methodIds,
  };
}

export interface UnmergeRecord {
  readonly mergeId: string;
  readonly restoredContactId: string;
}

/**
 * Undo a merge within 30 days: re-creates the loser under a FRESH id (never recycled),
 * moves the recorded rows back, marks the merge undone. After 30 days the record is
 * history and unmerge is refused. Rows created after the merge (new methods on the
 * winner) stay where they are — only recorded ids move back.
 */
export async function unmerge(client: TenantClient, mergeId: string): Promise<UnmergeRecord> {
  if (!UUID_RE.test(mergeId)) throw new RangeError('merge id must be a uuid');
  const found = await client.query<{
    id: string;
    winner_id: string;
    loser_id: string;
    moved_method_ids: string[];
    moved_link_ids: string[];
    moved_task_ids: string[];
    moved_lead_ids: string[];
    moved_request_ids: string[];
    moved_note_ids: string[];
    merged_at: Date;
    undone: boolean;
  }>(
    `select id, winner_id::text, loser_id::text, moved_method_ids, moved_link_ids,
       moved_task_ids, moved_lead_ids, moved_request_ids, moved_note_ids,
       merged_at, undone
     from contact_merges where id = $1`,
    [mergeId],
  );
  const record = found.rows[0];
  if (record === undefined) throw new VersionConflictError('merge record not found');
  if (record.undone) throw new VersionConflictError('merge already undone');
  const ageMs = Date.now() - new Date(record.merged_at).getTime();
  if (ageMs > UNMERGE_WINDOW_DAYS * 86_400_000) {
    throw new VersionConflictError('merge is past the 30-day window');
  }
  // Re-create the loser under a fresh id with the winner's current name (the name itself
  // is not versioned history; the links are what unmerge restores).
  const winner = await client.query<{ display_name: string }>(
    `select display_name from contacts where id = $1`,
    [record.winner_id],
  );
  const name = winner.rows[0]?.display_name;
  if (name === undefined) throw new VersionConflictError('merge winner is gone');
  const restoredId = randomUUID();
  await client.query(
    `insert into contacts (organisation_id, id, display_name) values (app.current_org(), $1, $2)`,
    [restoredId, name],
  );
  const moveBack = async (
    ids: readonly string[],
    table:
      | 'contact_methods'
      | 'conversations'
      | 'calls'
      | 'leads'
      | 'appointment_requests'
      | 'notes'
      | 'interaction_links'
      | 'tasks',
  ): Promise<void> => {
    if (ids.length === 0) return;
    // Branch-per-table: union member, never interpolated. Contact legs re-point to the
    // restored row; task legs re-point by conversation id (same restored id space per the
    // ledger's recording — tasks were recorded, not moved, so their ids return as-is).
    if (table === 'contact_methods') {
      await client.query(`update contact_methods set contact_id = $1 where id = any ($2)`, [
        restoredId,
        ids,
      ]);
    } else if (table === 'tasks') {
      await client.query(`update tasks set conversation_id = $1 where id = any ($2)`, [
        restoredId,
        ids,
      ]);
    } else if (table === 'conversations') {
      await client.query(`update conversations set contact_id = $1 where id = any ($2)`, [
        restoredId,
        ids,
      ]);
    } else if (table === 'calls') {
      await client.query(`update calls set contact_id = $1 where id = any ($2)`, [restoredId, ids]);
    } else if (table === 'leads') {
      await client.query(`update leads set contact_id = $1 where id = any ($2)`, [restoredId, ids]);
    } else if (table === 'appointment_requests') {
      await client.query(`update appointment_requests set contact_id = $1 where id = any ($2)`, [
        restoredId,
        ids,
      ]);
    } else if (table === 'notes') {
      await client.query(`update notes set contact_id = $1 where id = any ($2)`, [restoredId, ids]);
    } else {
      await client.query(`update interaction_links set contact_id = $1 where id = any ($2)`, [
        restoredId,
        ids,
      ]);
    }
  };
  await moveBack(record.moved_method_ids, 'contact_methods');
  // Link ids were recorded across conversations/calls/links; move each recorded id back by
  // trying each table (ids are unique per table, so at most one table matches each id).
  for (const table of [
    'conversations',
    'calls',
    'interaction_links',
    'leads',
    'appointment_requests',
    'notes',
  ] as const) {
    await moveBack(record.moved_link_ids, table);
  }
  await moveBack(record.moved_task_ids, 'tasks');
  await moveBack(record.moved_lead_ids, 'leads');
  await moveBack(record.moved_request_ids, 'appointment_requests');
  await moveBack(record.moved_note_ids, 'notes');
  await client.query(
    `update contact_merges set undone = true, unmerged_at = clock_timestamp(),
       updated_at = clock_timestamp(), version = version + 1
     where id = $1 and undone = false`,
    [mergeId],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.undo',
    targetKind: 'contact_merge',
    targetId: mergeId,
    argsSanitized: { restored: record.moved_method_ids.length + record.moved_link_ids.length },
    result: 'succeeded',
  });
  return { mergeId, restoredContactId: restoredId };
}
