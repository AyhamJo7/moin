/**
 * Knowledge validity, staleness and re-verification (P09.06, BR-095).
 *
 * Three rules, enforced at the service layer (no DEFINER — the sweep runs as
 * the ordinary application role inside withTenant, under FORCE RLS):
 *
 * 1. EXPIRED NEVER SERVED: a live version past `valid_until` is invisible to
 *    every retrieval path. Expiry is absolute — sensitivity and verification
 *    age do not matter.
 * 2. OVERDUE-SENSITIVE STOPS: a restricted live version past its reverify
 *    deadline (approval time + `reverify_after`) is suspended — it stops
 *    serving and routes to escalation, until re-approved. Non-sensitive
 *    overdue items KEEP serving but carry a `stale` flag.
 * 3. REVERIFY SWEEP: `sweepReverify` suspends overdue restricted items, queues
 *    each due item once, and creates at most one open "Wissen prüfen" task per
 *    item (idempotency key `reverify:<itemId>` — repeats return the row).
 *
 * Category defaults (PLAN P09.06.01): menu 30 days, hours 90 days, prices 90
 * days, everything else 90 days. An explicit per-version value beats the
 * default; NULL deadline (pre-0057 rows) means never due.
 *
 * Deadlines are computed in SQL (`decided_at + reverify_after <= now`) — never
 * parsed in TS. Audit carries version numbers only (INV-12): never titles,
 * bodies, or categories.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { checkKnowledgeChannel } from './knowledge-channels.ts';
import { createTask } from './tasks.ts';
import type { TenantClient } from './tenant.ts';

/** Per-category reverify defaults in days (PLAN P09.06.01). */
const REVERIFY_DEFAULT_DAYS: Readonly<Record<string, number>> = {
  menu: 30,
  hours: 90,
  prices: 90,
};

/** Fallback for every category without its own default. */
const REVERIFY_FALLBACK_DAYS = 90;

/** The re-verification task title (German, owner-facing). */
export const REVERIFY_TASK_TITLE = 'Wissen prüfen';

/**
 * Days until re-verification is due for a category. Unknown categories fall
 * back to 90 days.
 */
export function reverifyDaysForCategory(category: string): number {
  return REVERIFY_DEFAULT_DAYS[category.trim().toLowerCase()] ?? REVERIFY_FALLBACK_DAYS;
}

/** A served answer with its staleness marker. */
export interface ServedVersion {
  readonly versionId: string;
  readonly stale: boolean;
}

interface DueRow extends Record<string, unknown> {
  item_id: string;
  version_id: string;
  version_no: number;
  sensitivity: string;
}

/**
 * Whether the live version of an item may serve, and whether the answer is
 * stale. Expired → never (null). Suspended, conflicted, or overdue-restricted
 * → never (null, escalation path). Overdue otherwise → serves with stale=true.
 * Fresh → serves with stale=false. `now` is injectable for tests.
 *
 * Sensitivity mapping: knowledge `restricted` is the overdue-stops class
 * (public/internal keep serving flagged). FAQ `sensitive` maps the same way
 * in findAnswerStale (approved-card-only content stops when overdue).
 */
export async function servedState(
  client: TenantClient,
  itemId: string,
  now: Date = new Date(),
  channel?: string,
): Promise<ServedVersion | null> {
  checkKnowledgeChannel(channel);
  const found = await client.query<{
    version_id: string;
    expired: boolean;
    overdue: boolean;
    sensitivity: string;
    suspended: boolean;
    conflicted: boolean;
  }>(
    `select v.id as version_id,
            coalesce(v.valid_until < $2::date, false) as expired,
            coalesce(a.decided_at + v.reverify_after <= $3::timestamptz, false) as overdue,
            v.sensitivity, i.suspended, (i.conflict_state <> 'clear') as conflicted
     from knowledge_items i
     join knowledge_versions v
       on v.organisation_id = i.organisation_id and v.id = i.live_version_id
     left join knowledge_approvals a
       on a.organisation_id = i.organisation_id and a.version_id = v.id
     where i.organisation_id = app.current_org() and i.id = $1
        and i.state = 'approved' and v.state = 'approved'
        and ($4::text is null and v.allowed_channels @> '{call,message,voice,email,web}'
             or $4::text = any (v.allowed_channels))`,
    [itemId, now.toISOString().slice(0, 10), now.toISOString(), channel ?? null],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  if (row.expired) return null;
  if (row.suspended) return null;
  if (row.conflicted) return null;
  if (!row.overdue) return { versionId: row.version_id, stale: false };
  if (row.sensitivity === 'restricted') return null;
  return { versionId: row.version_id, stale: true };
}

export interface SweepResult {
  readonly checked: number;
  readonly suspended: number;
  readonly tasksCreated: number;
}

/** Candidate card row: what the lock-free select hands the locked re-read. */
export interface SweepCandidate extends Record<string, unknown> {
  readonly id: string;
  readonly sensitivity: string;
  readonly anchor: string;
}

/**
 * Locked eligibility re-read (ROUND-8 seam): given candidate ids, re-checks the
 * FULL predicate minus the queue leg under FOR UPDATE row locks, in id order.
 * Cards deactivated / refreshed / expired after the candidate select are
 * absent here → skipped. Exported so the regression test can drive the two
 * phases separately with an interleaved update between them — the production
 * sweep calls it immediately after the candidate select (same transaction).
 */
export async function lockEligibleCards(
  client: TenantClient,
  candidateIds: readonly string[],
  day: string,
  instant: string,
): Promise<readonly SweepCandidate[]> {
  if (candidateIds.length === 0) return [];
  const locked = await client.query<SweepCandidate>(
    // FOR UPDATE cannot touch the nullable queue side of an outer join, so
    // the lock targets faq_cards alone by id; the re-check repeats active +
    // unexpired + still overdue — the queue conflict is caught by the
    // anchor-carrying INSERT...SELECT below, which skips on zero rows.
    // Cards failing the recheck are simply absent here → skipped.
    `select id::text, sensitivity,
            extract(epoch from updated_at)::bigint::text as anchor
     from faq_cards
     where organisation_id = app.current_org()
       and id = any ($3::uuid[])
       and active = true
       and coalesce(valid_until < $1::date, false) = false
       and coalesce(updated_at + reverify_after <= $2::timestamptz, false) = true
     order by id for update`,
    [day, instant, [...candidateIds]],
  );
  return locked.rows;
}

/**
 * Reverify sweep: for every approved, non-suspended item whose live version is
 * neither expired nor (yet) handled — suspend it when restricted-overdue,
 * queue it once, and create at most one open task per item. Overdue faq cards
 * are swept in the same run (task-only for public/internal; overdue sensitive
 * cards deactivate via active=false, mirroring item suspension — re-activated
 * by the next card update, which bumps updated_at and restarts the deadline).
 *
 * Idempotent per item: the queue UNIQUE (org, item) collapses repeats, and the
 * task idempotency key `reverify:<item>:<version>` mints one fresh task per
 * approved version per cycle (never recycles a DONE task from a prior cycle).
 */
export async function sweepReverify(
  client: TenantClient,
  now: Date = new Date(),
): Promise<SweepResult> {
  const day = now.toISOString().slice(0, 10);
  const instant = now.toISOString();
  // Only UNHANDLED items: skip suspended ones (already escalated) and items
  // that already have a queue row (already tasked or already counted). Without
  // the queue exclusion a second sweep would re-count handled public items as
  // "checked" — the sweep must converge to zero new work.
  const live = await client.query<DueRow>(
    `select i.id as item_id, v.id as version_id, v.version_no, v.sensitivity
     from knowledge_items i
     join knowledge_versions v
       on v.organisation_id = i.organisation_id and v.id = i.live_version_id
     left join knowledge_approvals a
       on a.organisation_id = i.organisation_id and a.version_id = v.id
     left join knowledge_reverify_queue q
       on q.organisation_id = i.organisation_id and q.item_id = i.id
     where i.organisation_id = app.current_org()
       and i.state = 'approved' and v.state = 'approved' and not i.suspended
       and q.item_id is null
       and coalesce(v.valid_until < $1::date, false) = false
       and coalesce(a.decided_at + v.reverify_after <= $2::timestamptz, false) = true`,
    [day, instant],
  );
  let checked = 0;
  let suspended = 0;
  let tasksCreated = 0;
  for (const row of live.rows) {
    checked += 1;
    const restricted = row.sensitivity === 'restricted';
    if (restricted) {
      // Version-guarded (ROUND-2 P1-2) + already-handled guard (ROUND-3 P2-2):
      // an approval committing between select and update moves the live
      // pointer, and a concurrent sweep may have suspended first — both lose
      // honestly with 0 rows affected (skip side effects: no double suspend
      // audit, no task for a version that is no longer live).
      const guarded = await client.query(
        `update knowledge_items set suspended = true
         where id = $1 and live_version_id = $2 and not suspended`,
        [row.item_id, row.version_id],
      );
      if ((guarded.rowCount ?? 0) === 0) continue;
      suspended += 1;
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'knowledge.suspend',
        targetKind: 'knowledge_item',
        targetId: row.item_id,
        argsSanitized: { version_no: row.version_no },
        result: 'succeeded',
      });
    }
    // First-writer-wins (ROUND-4 P1, same shape as the card path): a
    // concurrent sweep may have queued this item first. ON CONFLICT DO
    // NOTHING inserts zero rows for the loser (node-pg reports rowCount
    // null, never 0 — check `!== 1`). The loser skips task + audit.
    const inserted = await client.query(
      `insert into knowledge_reverify_queue (organisation_id, id, item_id, due_at)
       values (app.current_org(), $1, $2, $3)
       on conflict (organisation_id, item_id) do nothing`,
      [randomUUID(), row.item_id, instant],
    );
    if (inserted.rowCount !== 1) continue;
    // Per-CYCLE key (ROUND-2 P1-1): reverify:<item>:<liveVersion>. A bare
    // per-item key would first-write-win back the DONE task from the previous
    // cycle — the queue row is deleted on approve, so the next sweep must
    // mint a FRESH task for the newly approved version, never recycle the
    // completed one.
    const task = await createTask(client, {
      title: REVERIFY_TASK_TITLE,
      type: 'review',
      priority: restricted ? 'high' : 'normal',
      idempotencyKey: `reverify:${row.item_id}:${row.version_id}`,
    });
    await client.query(`update knowledge_reverify_queue set task_id = $1 where item_id = $2`, [
      task.id,
      row.item_id,
    ]);
    tasksCreated += 1;
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'knowledge.reverify_task',
      targetKind: 'knowledge_item',
      targetId: row.item_id,
      argsSanitized: { version_no: row.version_no },
      result: 'succeeded',
    });
  }
  // FAQ cards (ROUND-2 P2-2, handled-state ROUND-3 P1-2): the same predicate
  // over updated_at, excluding cards the sweep already handled (queue row with
  // this card_id — mirrors the item exclusion, so the sweep converges). The
  // per-cycle key carries the card's updated_at epoch: an owner update bumps
  // updated_at (and deletes the queue row, re-arming the card), so the next
  // overdue cycle mints a fresh task instead of recycling the old one.
  //
  // CONCURRENCY (ROUND-6 P1): the select locks every candidate card row FOR
  // UPDATE, in id order. FOR UPDATE cannot touch the nullable (queue) side
  // of the outer join — so the lock targets faq_cards only, via a subselect:
  // candidates are computed lock-free, then the card rows are re-read FOR
  // UPDATE by id. The lock is held for the sweep transaction's duration, so
  // a concurrent updateFaqCard (same row lock via its version-guarded UPDATE)
  // blocks until the sweep commits or aborts — the INSERT...SELECT anchor
  // check then reads the COMMITTED updated_at, never a stale snapshot. This
  // serializes exactly like the sensitive path (whose guarded UPDATE takes
  // the same lock). Lock order is single-table, id-ordered, so no deadlock
  // cycle exists with the update path. BOTH the lock and the anchor re-check
  // are needed: the anchor alone races under READ COMMITTED (snapshot taken
  // at statement start can predate a concurrent commit).
  const candidates = await client.query<{ id: string; sensitivity: string; anchor: string }>(
    `select c.id::text, c.sensitivity, extract(epoch from c.updated_at)::bigint::text as anchor
     from faq_cards c
     left join knowledge_reverify_queue q
       on q.organisation_id = c.organisation_id and q.card_id = c.id
     where c.organisation_id = app.current_org() and c.active = true
       and q.card_id is null
       and coalesce(c.valid_until < $1::date, false) = false
       and coalesce(c.updated_at + c.reverify_after <= $2::timestamptz, false) = true
     order by c.id`,
    [day, instant],
  );
  const locked = await lockEligibleCards(
    client,
    candidates.rows.map((r) => r.id),
    day,
    instant,
  );
  for (const card of locked) {
    const sensitive = card.sensitivity === 'sensitive';
    if (sensitive) {
      // Anchor-guarded (ROUND-4 P1): an owner update committing between the
      // select and this update bumps updated_at — deactivating by id alone
      // would kill the REVIEWED card. Zero rows = the update won: skip, the
      // fresh content has a fresh deadline.
      const guarded = await client.query(
        `update faq_cards set active = false where id = $1
         and extract(epoch from updated_at)::bigint = $2::bigint and active = true`,
        [card.id, card.anchor],
      );
      if ((guarded.rowCount ?? 0) === 0) continue;
      checked += 1;
      await appendAuditEvent(client, {
        source: 'api',
        operation: 'faq.suspend',
        targetKind: 'faq_card',
        targetId: card.id,
        argsSanitized: { version: 1 },
        result: 'succeeded',
      });
    } else {
      checked += 1;
    }
    // Anchor-guarded queue insert (ROUND-5 P1): an owner update committing
    // between the select and this insert bumps updated_at AND deletes the
    // queue row (updateFaqCard re-arms). Inserting unconditionally would
    // re-plant a STALE row + task that suppresses the next cycle for the
    // reviewed card. So the insert itself carries the anchor: zero rows =
    // the update won (or a concurrent sweep won) → skip task + audit.
    // Sweep-vs-sweep stays first-writer-wins via the same check (node-pg
    // reports rowCount null, never 0, for ON CONFLICT DO NOTHING — check
    // `!== 1`, never `=== 0`).
    const queued = await client.query(
      `insert into knowledge_reverify_queue (organisation_id, id, card_id, due_at)
       select app.current_org(), $1, $2, $3 from faq_cards
       where id = $2 and extract(epoch from updated_at)::bigint = $4::bigint
       on conflict (organisation_id, card_id) do nothing`,
      [randomUUID(), card.id, instant, card.anchor],
    );
    if (queued.rowCount !== 1) continue;
    const task = await createTask(client, {
      title: REVERIFY_TASK_TITLE,
      type: 'review',
      priority: sensitive ? 'high' : 'normal',
      idempotencyKey: `reverify-card:${card.id}:${card.anchor}`,
    });
    // Card tasks are per-cycle idempotent (same key retries the same row):
    // assert the row exists so a silent no-op cannot pass unnoticed.
    const created = await client.query<{ n: string }>(
      `select count(*)::text as n from tasks where id = $1`,
      [task.id],
    );
    if (created.rows[0]?.n !== '1') throw new Error('card task create returned no row');
    await client.query(`update knowledge_reverify_queue set task_id = $1 where card_id = $2`, [
      task.id,
      card.id,
    ]);
    tasksCreated += 1;
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'faq.reverify_task',
      targetKind: 'faq_card',
      targetId: card.id,
      argsSanitized: { version: 1 },
      result: 'succeeded',
    });
  }
  return { checked, suspended, tasksCreated };
}
