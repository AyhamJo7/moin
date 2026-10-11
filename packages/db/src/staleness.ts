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
 * stale. Expired → never (null). Suspended or overdue-restricted → never
 * (null, escalation path). Overdue otherwise → serves with stale=true.
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
): Promise<ServedVersion | null> {
  const found = await client.query<{
    version_id: string;
    expired: boolean;
    overdue: boolean;
    sensitivity: string;
    suspended: boolean;
  }>(
    `select v.id as version_id,
            coalesce(v.valid_until < $2::date, false) as expired,
            coalesce(a.decided_at + v.reverify_after <= $3::timestamptz, false) as overdue,
            v.sensitivity, i.suspended
     from knowledge_items i
     join knowledge_versions v
       on v.organisation_id = i.organisation_id and v.id = i.live_version_id
     left join knowledge_approvals a
       on a.organisation_id = i.organisation_id and a.version_id = v.id
     where i.organisation_id = app.current_org() and i.id = $1
       and i.state = 'approved' and v.state = 'approved'`,
    [itemId, now.toISOString().slice(0, 10), now.toISOString()],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  if (row.expired) return null;
  if (row.suspended) return null;
  if (!row.overdue) return { versionId: row.version_id, stale: false };
  if (row.sensitivity === 'restricted') return null;
  return { versionId: row.version_id, stale: true };
}

export interface SweepResult {
  readonly checked: number;
  readonly suspended: number;
  readonly tasksCreated: number;
}

/**
 * Reverify sweep: for every approved, non-suspended item whose live version is
 * neither expired nor (yet) handled — suspend it when restricted-overdue,
 * queue it once, and create at most one open task per item.
 *
 * Idempotent per item: the queue UNIQUE (org, item) collapses repeats, and the
 * task idempotency key `reverify:<itemId>` returns the existing row on retry.
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
      await client.query(`update knowledge_items set suspended = true where id = $1`, [
        row.item_id,
      ]);
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
    await client.query(
      `insert into knowledge_reverify_queue (organisation_id, id, item_id, due_at)
       values (app.current_org(), $1, $2, $3)
       on conflict (organisation_id, item_id) do nothing`,
      [randomUUID(), row.item_id, instant],
    );
    const queued = await client.query<{ task_id: string | null }>(
      `select task_id::text from knowledge_reverify_queue where item_id = $1`,
      [row.item_id],
    );
    if (queued.rows[0]?.task_id != null) continue;
    const task = await createTask(client, {
      title: REVERIFY_TASK_TITLE,
      type: 'review',
      priority: restricted ? 'high' : 'normal',
      idempotencyKey: `reverify:${row.item_id}`,
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
  return { checked, suspended, tasksCreated };
}
