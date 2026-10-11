/**
 * Knowledge conflict detection (P09.07, BR-126, FS-15).
 *
 * Detectors flag contradictions FOR REVIEW — never auto-resolution. An
 * approved item (or faq card) named by an OPEN conflict stops serving and
 * routes to the callback path; resolving the conflict (owner reviewed) clears
 * the suspension. Every detection run is idempotent per subject pair; every
 * conflict carries at most one open task.
 *
 * Detectors:
 * - hours-overlap: two opening_rules, same location + weekday, overlapping
 *   wall-clock minutes (midnight-spanning intervals normalized to segments).
 *   Deterministic — runs on every weekly-rules write AND on demand via sweep.
 * - faq-duplicate: two faq_cards whose canonicals score above the trigram
 *   threshold — a merge candidate for owner review, never an auto-merge.
 * - item-contradiction: reserved for the P10 LLM contradiction check; rows may
 *   be written by the review flow (openContradiction), the sweep never invents
 *   them.
 *
 * Leg ordering happens HERE (orderLegs: sort uuid-texts, insert ordered) —
 * no DB trigger (the catalog has no review surface for new trigger fns; the
 * UNIQUE still refuses mirror duplicates at the boundary).
 *
 * Audit carries detector + version markers only (INV-12): never titles,
 * bodies, canonicals, or hours.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { createTask } from './tasks.ts';
import type { TenantClient } from './tenant.ts';

/** Detectors that may raise a conflict row. */
export type ConflictDetector = 'hours-overlap' | 'faq-duplicate' | 'item-contradiction';

/** What the two legs point at. */
export type ConflictSubjectKind = 'opening-rule' | 'faq-card' | 'knowledge-item';

/** Trigram similarity at or above which two canonicals are merge candidates. */
export const FAQ_DUPLICATE_THRESHOLD = 0.6;

/** The conflict task title (German, owner-facing). */
export const CONFLICT_TASK_TITLE = 'Wissenskonflikt prüfen';

export interface ConflictSweepResult {
  readonly checked: number;
  readonly opened: number;
  readonly tasksCreated: number;
}

/** Sort the two leg uuids into canonical order (mirror pairs share one row). */
export function orderLegs(a: string, b: string): readonly [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/** Split a wall-clock interval into non-wrapping [start, end) segments. */
function segments(opensMin: number, closesMin: number): readonly (readonly [number, number])[] {
  if (opensMin < closesMin) return [[opensMin, closesMin]];
  return [
    [opensMin, 1440],
    [0, closesMin],
  ];
}

function overlaps(aOpens: number, aCloses: number, bOpens: number, bCloses: number): boolean {
  for (const [aStart, aEnd] of segments(aOpens, aCloses)) {
    for (const [bStart, bEnd] of segments(bOpens, bCloses)) {
      if (aStart < bEnd && bStart < aEnd) return true;
    }
  }
  return false;
}

interface RuleRow extends Record<string, unknown> {
  id: string;
  location_id: string;
  weekday: number;
  opens_min: number;
  closes_min: number;
}

/**
 * Detect overlapping weekly rules: same location + weekday, overlapping
 * minutes. Writes one conflict row per pair (upsert — repeats are no-ops),
 * suspends nothing directly (rules are not served content), but tasks the
 * owner once per pair. Returns pairs opened.
 */
export async function detectHoursOverlaps(client: TenantClient): Promise<ConflictSweepResult> {
  const rules = await client.query<RuleRow>(
    `select id::text, location_id::text, weekday, opens_min, closes_min
     from opening_rules where organisation_id = app.current_org() order by id`,
  );
  let checked = 0;
  let opened = 0;
  let tasksCreated = 0;
  const rows = rules.rows;
  for (let i = 0; i < rows.length; i += 1) {
    const left = rows[i];
    if (left === undefined) continue;
    for (let j = i + 1; j < rows.length; j += 1) {
      const right = rows[j];
      if (right === undefined) continue;
      if (left.location_id !== right.location_id || left.weekday !== right.weekday) continue;
      checked += 1;
      if (!overlaps(left.opens_min, left.closes_min, right.opens_min, right.closes_min)) continue;
      const [a, b] = orderLegs(left.id, right.id);
      const done = await openConflict(client, {
        detector: 'hours-overlap',
        subjectKind: 'opening-rule',
        subjectA: a,
        subjectB: b,
        reason: `weekday ${String(left.weekday)} overlap`,
      });
      opened += done.opened ? 1 : 0;
      tasksCreated += done.tasked ? 1 : 0;
    }
  }
  return { checked, opened, tasksCreated };
}

interface CardRow extends Record<string, unknown> {
  id: string;
  canonical: string;
}

/**
 * Detect near-duplicate faq canonicals via trigram similarity: pairs at or
 * above FAQ_DUPLICATE_THRESHOLD become merge candidates (flag-for-review).
 * Deterministic; never merges.
 */
export async function detectFaqDuplicates(client: TenantClient): Promise<ConflictSweepResult> {
  const cards = await client.query<CardRow>(
    `select id::text, canonical from faq_cards
     where organisation_id = app.current_org() and active = true order by id`,
  );
  let checked = 0;
  let opened = 0;
  let tasksCreated = 0;
  const rows = cards.rows;
  for (let i = 0; i < rows.length; i += 1) {
    const left = rows[i];
    if (left === undefined) continue;
    for (let j = i + 1; j < rows.length; j += 1) {
      const right = rows[j];
      if (right === undefined) continue;
      checked += 1;
      const sim = await client.query<{ score: string }>(
        `select similarity($1::text, $2::text)::text as score`,
        [left.canonical, right.canonical],
      );
      if (Number(sim.rows[0]?.score ?? '0') < FAQ_DUPLICATE_THRESHOLD) continue;
      const [a, b] = orderLegs(left.id, right.id);
      const done = await openConflict(client, {
        detector: 'faq-duplicate',
        subjectKind: 'faq-card',
        subjectA: a,
        subjectB: b,
        reason: `similarity ${sim.rows[0]?.score ?? '?'}`,
      });
      opened += done.opened ? 1 : 0;
      tasksCreated += done.tasked ? 1 : 0;
    }
  }
  return { checked, opened, tasksCreated };
}

/**
 * Open one conflict row (upsert on the ordered pair): suspends knowledge-item
 * / faq-card subjects while OPEN, tasks the owner once per pair. Returns
 * whether this call opened the row and whether it tasked.
 */
export async function openConflict(
  client: TenantClient,
  input: {
    detector: ConflictDetector;
    subjectKind: ConflictSubjectKind;
    subjectA: string;
    subjectB: string;
    reason: string;
  },
): Promise<{ opened: boolean; tasked: boolean }> {
  const [a, b] = orderLegs(input.subjectA, input.subjectB);
  const inserted = await client.query<{ id: string }>(
    `insert into knowledge_conflicts
       (organisation_id, id, detector, subject_kind, subject_a, subject_b, reason)
     values (app.current_org(), $1, $2, $3, $4::uuid, $5::uuid, $6::text)
     on conflict (organisation_id, detector, subject_kind, subject_a, subject_b)
     do update set reason = excluded.reason
     returning id::text`,
    [randomUUID(), input.detector, input.subjectKind, a, b, input.reason.slice(0, 300)],
  );
  const conflictId = inserted.rows[0]?.id;
  if (conflictId === undefined) throw new Error('conflict upsert returned no row');
  // Repeat detection must not re-task: when the row already carries a task,
  // report opened=false (nothing new happened). The task key is per-pair, so
  // createTask would first-write-win the same row back anyway — but the
  // counts must say so honestly.
  const already = await client.query<{ task_id: string | null }>(
    `select task_id::text from knowledge_conflicts
     where organisation_id = app.current_org() and id = $1::uuid`,
    [conflictId],
  );
  if (already.rows[0]?.task_id != null) {
    await suspendSubjects(client, input.subjectKind, [a, b]);
    return { opened: false, tasked: false };
  }
  // A repeat (row already open with a task) tasks nothing new: the task key is
  // per-pair, and createTask first-write-wins the same row back.
  const key =
    input.subjectKind === 'opening-rule'
      ? `conflict:hours:${a}:${b}`
      : `conflict:${input.subjectKind}:${a}:${b}`;
  const task = await createTask(client, {
    title: CONFLICT_TASK_TITLE,
    type: 'review',
    priority: 'high',
    idempotencyKey: key,
  });
  const linked = await client.query<{ n: string }>(
    `select count(*)::text as n from knowledge_conflicts
     where organisation_id = app.current_org() and id = $1::uuid and task_id is not null`,
    [conflictId],
  );
  let tasked = false;
  if (linked.rows[0]?.n === '0') {
    await client.query(`update knowledge_conflicts set task_id = $1 where id = $2::uuid`, [
      task.id,
      conflictId,
    ]);
    tasked = true;
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'knowledge.conflict_open',
      targetKind: input.subjectKind === 'opening-rule' ? 'opening_rule' : 'knowledge_item',
      argsSanitized: { detector: input.detector === 'hours-overlap' ? 0 : 1 },
      result: 'succeeded',
    });
  }
  await suspendSubjects(client, input.subjectKind, [a, b]);
  return { opened: true, tasked };
}

async function suspendSubjects(
  client: TenantClient,
  kind: ConflictSubjectKind,
  ids: readonly string[],
): Promise<void> {
  if (kind === 'knowledge-item') {
    await client.query(
      `update knowledge_items set conflict_state = 'conflicted'
       where organisation_id = app.current_org() and id = any ($1::uuid[])`,
      [ids],
    );
  } else if (kind === 'faq-card') {
    await client.query(
      `update faq_cards set active = false
       where organisation_id = app.current_org() and id = any ($1::uuid[])`,
      [ids],
    );
  }
  // opening-rule subjects are not served content: nothing to suspend.
}

/**
 * Resolve a conflict (owner reviewed): marks the row resolved with a note,
 * clears the suspension on subjects that have NO other open conflict.
 * Returns false when the row does not exist or is already resolved.
 */
export async function resolveConflict(
  client: TenantClient,
  input: { conflictId: string; note: string },
): Promise<boolean> {
  const trimmed = input.note.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw new RangeError('resolution note must be 1..500 characters');
  }
  const found = await client.query<{
    detector: string;
    subject_kind: string;
    subject_a: string;
    subject_b: string;
    status: string;
  }>(
    `select detector, subject_kind, subject_a::text, subject_b::text, status
     from knowledge_conflicts
     where organisation_id = app.current_org() and id = $1::uuid`,
    [input.conflictId],
  );
  const row = found.rows[0];
  if (row?.status !== 'open') return false;
  await client.query(
    `update knowledge_conflicts set status = 'resolved', resolved_at = now(),
       resolution_note = $2::text where id = $1::uuid`,
    [input.conflictId, trimmed],
  );
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.conflict_resolve',
    targetKind: row.subject_kind === 'opening-rule' ? 'opening_rule' : 'knowledge_item',
    argsSanitized: { detector: row.detector === 'hours-overlap' ? 0 : 1 },
    result: 'succeeded',
  });
  // Clear suspension only on subjects with no OTHER open conflict — one
  // resolution must not unsuspend an item still contradicted elsewhere.
  for (const subjectId of [row.subject_a, row.subject_b]) {
    const still = await client.query<{ n: string }>(
      `select count(*)::text as n from knowledge_conflicts
       where organisation_id = app.current_org() and status = 'open'
         and subject_kind = $1 and (subject_a = $2::uuid or subject_b = $2::uuid)`,
      [row.subject_kind, subjectId],
    );
    if (still.rows[0]?.n !== '0') continue;
    if (row.subject_kind === 'knowledge-item') {
      await client.query(
        `update knowledge_items set conflict_state = 'clear'
         where organisation_id = app.current_org() and id = $1::uuid`,
        [subjectId],
      );
    } else if (row.subject_kind === 'faq-card') {
      await client.query(
        `update faq_cards set active = true
         where organisation_id = app.current_org() and id = $1::uuid`,
        [subjectId],
      );
    }
  }
  return true;
}
