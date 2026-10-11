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

/**
 * Insert-or-return the open row for one signal. SELECT-first is the fast path (and gives
 * the stored-suggestion-stands semantics: a re-suggest with different inputs is not an
 * update — it returns the open row without auditing). Under concurrency both racers can
 * miss the SELECT; the INSERT then races the partial pair unique with the matching
 * arbiter, so the loser gets an empty RETURNING (not a 23505) and falls back to the
 * re-read. The audit fires only when this call actually inserted (RETURNING non-empty).
 */
async function insertSignal(
  client: TenantClient,
  first: string,
  second: string,
  kind: CandidateSignal,
  value: string,
  columns: string,
  extraValues: readonly string[],
): Promise<CandidateRow> {
  const existing = await client.query<CandidateRow>(
    `select id, contact_a_id, contact_b_id, kind, status from duplicate_candidates
     where organisation_id = app.current_org() and contact_a_id = $1
       and contact_b_id = $2 and kind = $3 and status = 'open'`,
    [first, second, kind],
  );
  const open = existing.rows[0];
  if (open !== undefined) return open;
  // Branch-per-column-set (governance.ts purgeCandidates shape): the column list is a
  // union member, never interpolated — the lint bans string-built SQL outright.
  const inserted =
    columns === 'name_postal'
      ? await client.query<CandidateRow>(
          `insert into duplicate_candidates
             (organisation_id, id, contact_a_id, contact_b_id, kind, value, signal_name, signal_postal)
           values (app.current_org(), $1, $2, $3, 'name_postal', $4, $5, $6)
           on conflict (organisation_id, contact_a_id, contact_b_id, kind)
             where status = 'open' and kind in ('name_postal', 'email_local', 'ai_similarity')
           do nothing
           returning id, contact_a_id, contact_b_id, kind, status`,
          [randomUUID(), first, second, value, extraValues[0], extraValues[1]],
        )
      : columns === 'email_local'
        ? await client.query<CandidateRow>(
            `insert into duplicate_candidates
               (organisation_id, id, contact_a_id, contact_b_id, kind, value, signal_local)
             values (app.current_org(), $1, $2, $3, 'email_local', $4, $5)
             on conflict (organisation_id, contact_a_id, contact_b_id, kind)
               where status = 'open' and kind in ('name_postal', 'email_local', 'ai_similarity')
             do nothing
             returning id, contact_a_id, contact_b_id, kind, status`,
            [randomUUID(), first, second, value, extraValues[0]],
          )
        : await client.query<CandidateRow>(
            `insert into duplicate_candidates
               (organisation_id, id, contact_a_id, contact_b_id, kind, value, ai_suggested)
             values (app.current_org(), $1, $2, $3, 'ai_similarity', $4, true)
             on conflict (organisation_id, contact_a_id, contact_b_id, kind)
               where status = 'open' and kind in ('name_postal', 'email_local', 'ai_similarity')
             do nothing
             returning id, contact_a_id, contact_b_id, kind, status`,
            [randomUUID(), first, second, value],
          );
  const row =
    inserted.rows[0] ??
    (
      await client.query<CandidateRow>(
        `select id, contact_a_id, contact_b_id, kind, status from duplicate_candidates
         where organisation_id = app.current_org() and contact_a_id = $1
           and contact_b_id = $2 and kind = $3 and status = 'open'`,
        [first, second, kind],
      )
    ).rows[0];
  if (row === undefined) throw new Error('candidate suggest returned no row');
  if (inserted.rows[0] !== undefined) {
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'merge.suggest',
      targetKind: 'duplicate_candidate',
      targetId: row.id,
      argsSanitized: { signal: SIGNAL_MARKER[kind] },
      result: 'succeeded',
    });
  }
  return row;
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
  // Signal `value` is scoped to the ordered pair (`A~B~…`): the 0037 (kind, value, status)
  // unique then collides only within the pair — a different pair with the same signal
  // values gets a distinct value and never trips the old arbiter. The pair unique above
  // is the dedup index (pair-scoped, not value-scoped).
  return toCandidate(
    await insertSignal(
      client,
      first,
      second,
      'name_postal',
      `${first}~${second}~${name} ${postal}`,
      'name_postal',
      [name, postal],
    ),
  );
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
  return toCandidate(
    await insertSignal(
      client,
      first,
      second,
      'email_local',
      `${first}~${second}~${local}`,
      'email_local',
      [local],
    ),
  );
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
  return toCandidate(
    await insertSignal(
      client,
      first,
      second,
      'ai_similarity',
      `${first}~${second}`,
      'ai_similarity',
      [],
    ),
  );
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
  if (input.candidateId !== undefined) {
    // Validate the candidate BEFORE moving anything: open, and naming this exact ordered
    // pair. A candidate for another pair (or an already-consumed one) is a 409, never a
    // silent consume — the approver clicked the wrong suggestion or lost a race.
    const [first, second] =
      input.winnerId < input.loserId
        ? [input.winnerId, input.loserId]
        : [input.loserId, input.winnerId];
    const candidate = await client.query<{ id: string }>(
      `select id from duplicate_candidates where id = $1 and status = 'open'
         and contact_a_id = $2 and contact_b_id = $3`,
      [input.candidateId, first, second],
    );
    if (candidate.rows[0] === undefined) {
      throw new VersionConflictError('merge candidate mismatch');
    }
  }
  const mergeId = randomUUID();
  // Move interaction_links FIRST, before their methods move: the triple FK
  // (organisation, contact, method) → contact_methods is immediate and non-deferrable
  // (0038 merged, immutable), so neither order of two UPDATEs can satisfy it mid-move —
  // moving links first would dangle (W,M) with the method still at (L,M), moving methods
  // first dangles (L,M) links. Instead links are DELETED and re-INSERTED after the
  // methods land: the re-insert names the winner pair directly, and the ledger records
  // the rewritten link ids. The link's rule/label/interaction_ref survive verbatim —
  // only the contact leg changes — so no verdict is lost, and the audit counts the
  // rewrite. (A DEFERRABLE triple would also work but rewrites reviewed 0038 semantics;
  // delete+recreate keeps every constraint exactly as reviewed.)
  const doomedLinks = await client.query<{
    id: string;
    interaction_ref: string;
    method_id: string;
    rule: string;
    label_de: string;
  }>(
    `delete from interaction_links where contact_id = $1
     returning id::text, interaction_ref, method_id::text, rule, label_de`,
    [input.loserId],
  );
  // Move methods: the verified-unique index cannot collide — the pair was suggested
  // exactly because both contacts own the same verified value through DIFFERENT rows,
  // and the loser's rows leave it (UPDATE, not copy): the winner ends with the union.
  const methods = await client.query<{ id: string }>(
    `update contact_methods set contact_id = $1, updated_at = clock_timestamp(), version = version + 1
     where contact_id = $2
     returning id::text`,
    [input.winnerId, input.loserId],
  );
  const methodIds = methods.rows.map((r) => r.id);
  // Re-create the doomed links against the winner: method rows now live at (W, M), so
  // the triple FK is satisfied directly. Fresh link ids (the old rows are gone); the
  // ledger records the NEW ids, and unmerge moves exactly these back.
  const linkIds: string[] = [];
  for (const doomed of doomedLinks.rows) {
    const recreated = await client.query<{ id: string }>(
      `insert into interaction_links
         (organisation_id, id, interaction_ref, contact_id, method_id, rule, label_de)
       values (app.current_org(), $1, $2, $3, $4, $5, $6)
       returning id::text`,
      [
        randomUUID(),
        doomed.interaction_ref,
        input.winnerId,
        doomed.method_id,
        doomed.rule,
        doomed.label_de,
      ],
    );
    const fresh = recreated.rows[0];
    if (fresh === undefined) throw new Error('link re-insert returned no row');
    linkIds.push(fresh.id);
  }
  const moveLinks = async (
    table: 'conversations' | 'calls' | 'leads' | 'appointment_requests' | 'notes',
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
              : await client.query<{ id: string }>(
                  `update notes set contact_id = $1 where contact_id = $2 returning id::text`,
                  [input.winnerId, input.loserId],
                );
    return moved.rows.map((r) => r.id);
  };
  const convoIds = await moveLinks('conversations');
  const callIds = await moveLinks('calls');
  const leadIds = await moveLinks('leads');
  const requestIds = await moveLinks('appointment_requests');
  const noteIds = await moveLinks('notes');
  // Tasks link by conversation, not contact: they stay with their conversation, which
  // itself moved to the winner. The ledger records which task ids were OBSERVED on moved
  // conversations (for the audit count), but unmerge does not touch them — re-pointing a
  // task's conversation_id at a contact id would corrupt it.
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
        moved_method_ids, moved_link_ids, moved_conversation_ids, moved_call_ids,
        moved_task_ids, moved_lead_ids, moved_request_ids, moved_note_ids)
     values (app.current_org(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      mergeId,
      input.winnerId,
      input.loserId,
      input.approvedBy,
      input.candidateId ?? null,
      methodIds,
      linkIds,
      convoIds,
      callIds,
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
  const movedTotal =
    methodIds.length +
    linkIds.length +
    convoIds.length +
    callIds.length +
    taskIds.length +
    leadIds.length +
    requestIds.length +
    noteIds.length;
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.apply',
    targetKind: 'contact_merge',
    targetId: mergeId,
    argsSanitized: { moved: movedTotal },
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
    moved_conversation_ids: string[];
    moved_call_ids: string[];
    moved_task_ids: string[];
    moved_lead_ids: string[];
    moved_request_ids: string[];
    moved_note_ids: string[];
    merged_at: Date;
    undone: boolean;
  }>(
    `select id, winner_id::text, loser_id::text, moved_method_ids, moved_link_ids,
       moved_conversation_ids, moved_call_ids, moved_task_ids, moved_lead_ids,
       moved_request_ids, moved_note_ids, merged_at, undone
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
  // Serialise concurrent unmerges on the ledger row: the loser blocks, then the guarded
  // conditional UPDATE below finds undone = true and 409s. Without the lock both readers
  // see undone = false and both restore.
  await client.query(`select id from contact_merges where id = $1 for update`, [mergeId]);
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
  // Re-created link ids live in moved_link_ids (the pre-merge rows are gone); recorded
  // conversation/call/lead/request/note ids move back by table as usual. Links are
  // REWRITTEN, not moved: delete the winner's recreated rows and re-insert them against
  // the restored contact (same rule/label/interaction_ref, restored contact leg). The
  // triple FK is satisfied directly — no order violation in either direction.
  // Methods already moved back above, so the (restored, method) pairs exist.
  const doomed = await client.query<{
    interaction_ref: string;
    method_id: string;
    rule: string;
    label_de: string;
  }>(
    `delete from interaction_links where id = any ($1)
     returning interaction_ref, method_id::text, rule, label_de`,
    [record.moved_link_ids],
  );
  for (const row of doomed.rows) {
    await client.query(
      `insert into interaction_links
         (organisation_id, id, interaction_ref, contact_id, method_id, rule, label_de)
       values (app.current_org(), $1, $2, $3, $4, $5, $6)`,
      [randomUUID(), row.interaction_ref, restoredId, row.method_id, row.rule, row.label_de],
    );
  }
  // Conversations and calls moved by UPDATE (not rewrite): their contact legs return to
  // the restored contact. Without this they would strand on the winner while only the
  // links came back — the reviewer's HIGH.
  await moveBack(record.moved_conversation_ids, 'conversations');
  await moveBack(record.moved_call_ids, 'calls');
  // Tasks attach to conversations, not contacts: the ledger records which task ids were
  // observed on moved conversations, but the tasks themselves never moved — re-pointing
  // their conversation_id at a CONTACT id would corrupt them. Unmerge leaves tasks alone.
  await moveBack(record.moved_lead_ids, 'leads');
  await moveBack(record.moved_request_ids, 'appointment_requests');
  await moveBack(record.moved_note_ids, 'notes');
  const undone = await client.query(
    `update contact_merges set undone = true, unmerged_at = clock_timestamp(),
       updated_at = clock_timestamp(), version = version + 1
     where id = $1 and undone = false
     returning id::text`,
    [mergeId],
  );
  if (undone.rows[0] === undefined) throw new VersionConflictError('merge already undone');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'merge.undo',
    targetKind: 'contact_merge',
    targetId: mergeId,
    argsSanitized: {
      restored:
        record.moved_method_ids.length +
        record.moved_link_ids.length +
        record.moved_conversation_ids.length +
        record.moved_call_ids.length +
        record.moved_lead_ids.length +
        record.moved_request_ids.length +
        record.moved_note_ids.length,
    },
    result: 'succeeded',
  });
  return { mergeId, restoredContactId: restoredId };
}
