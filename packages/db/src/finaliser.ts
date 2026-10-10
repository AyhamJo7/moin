/**
 * No-lost-interaction invariant (P07.11, INV-06): every interaction ends with an outcome or an
 * open task.
 *
 * Two entry points share one idempotent core. `finaliseInteraction` is the synchronous path the
 * voice/webhook layer calls at interaction end; `reconcileOrphans` is the every-5-minutes sweep
 * that catches what a killed process left behind. Both converge on the
 * same verdict for the same conversation, in any order, any number of times: outcome exists or
 * an open task exists → no-op; otherwise create the deterministic fallback task
 * ("Rückruf – Anruf ohne Ergebnis", type `callback`) keyed by a deterministic idempotency key,
 * so concurrent finalisers return the same row instead of duplicating it.
 *
 * No new tables: outcomes come from `interaction_outcomes`, tasks from `tasks`, linkage from
 * `tasks.conversation_id`. The fallback title is fixed German copy; the audit rows carry verdict
 * markers, never content (INV-12).
 *
 * The alarm is a callback, not an import: the signal has to reach a log line, a metric and
 * eventually a CloudWatch alarm, and none of those belong in `@moin/db` (same shape as the
 * audit-chain verifier's `onBreak`). Metric name the wiring must emit: `interactions.orphaned`.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { getOutcome } from './conversations.ts';
import { createTask } from './tasks.ts';
import { withTenant, type TenantClient } from './tenant.ts';
import type { Pool } from './pool.ts';

/** Minutes after the last update a conversation without outcome or open task is orphaned. */
export const ORPHAN_AFTER_MINUTES = 10;
/** Tenants claimed per sweep page. The register function caps itself at 1000. */
export const RECONCILE_PAGE_SIZE = 200;

export type FinaliseVerdict = 'outcome-existed' | 'task-existed' | 'fallback-created';

const VERDICT_MARKER: Record<FinaliseVerdict, number> = {
  'outcome-existed': 0,
  'task-existed': 1,
  'fallback-created': 2,
};

const FALLBACK_TITLE = 'Rückruf – Anruf ohne Ergebnis';

/** Follow-up title when the deterministic fallback row is already closed. */
const FOLLOW_UP_TITLE = 'Erneuter Rückruf – vorherige Aufgabe geschlossen';

/** Task rungs that cover an interaction (mirrors the open-task claim predicate). */
const OPEN_TASK_STATUSES: ReadonlySet<string> = new Set(['open', 'in_progress', 'waiting']);

function fallbackKey(conversationId: string): string {
  return `finaliser-fallback:${conversationId}`;
}

async function openTaskExists(client: TenantClient, conversationId: string): Promise<boolean> {
  const found = await client.query<{ id: string }>(
    `select id from tasks where conversation_id = $1
       and status in ('open', 'in_progress', 'waiting') limit 1`,
    [conversationId],
  );
  return found.rows[0] !== undefined;
}

/**
 * Ensure a conversation ends with an outcome or an open task (idempotent).
 *
 * Check order is outcome → open task → create, and the create carries a deterministic
 * idempotency key, so any interleaving (finaliser vs reconciler, double run) converges: the
 * loser's insert returns the winner's row. A conversation whose task link was severed by
 * erasure (SET NULL) is finalised again — a repaired task is better than a lost interaction.
 *
 * Closed-fallback repair: the idempotent create can return an already-closed fallback (the
 * task was closed after a previous finalise, so no open task exists now). Returning it
 * would report fallback-created while the interaction is still uncovered, so a closed
 * return mints a fresh follow-up task under a new random key and returns that instead.
 */
export async function finaliseInteraction(
  client: TenantClient,
  conversationId: string,
): Promise<{ conversationId: string; verdict: FinaliseVerdict; taskId: string | null }> {
  const outcome = await getOutcome(client, conversationId);
  if (outcome !== null) {
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'interaction.finalise',
      targetKind: 'conversation',
      targetId: conversationId,
      argsSanitized: { verdict: VERDICT_MARKER['outcome-existed'] },
      result: 'succeeded',
    });
    return { conversationId, verdict: 'outcome-existed', taskId: null };
  }
  if (await openTaskExists(client, conversationId)) {
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'interaction.finalise',
      targetKind: 'conversation',
      targetId: conversationId,
      argsSanitized: { verdict: VERDICT_MARKER['task-existed'] },
      result: 'succeeded',
    });
    return { conversationId, verdict: 'task-existed', taskId: null };
  }
  // Deterministic key: retries and racers return the same row (first write wins).
  const task = await createTask(client, {
    title: FALLBACK_TITLE,
    type: 'callback',
    priority: 'high',
    conversationId,
    idempotencyKey: fallbackKey(conversationId),
  });
  if (!OPEN_TASK_STATUSES.has(task.status)) {
    // The deterministic row is closed: mint a fresh follow-up under a new random key so
    // the interaction is covered again. The random suffix is per attempt by design — a
    // deterministic key would return this same closed row forever. Type differs so the
    // one-system-task-per-interaction-and-type unique holds alongside the closed row.
    const followUp = await createTask(client, {
      title: FOLLOW_UP_TITLE,
      type: 'follow_up',
      priority: 'high',
      conversationId,
      idempotencyKey: `${fallbackKey(conversationId)}:retry:${randomUUID()}`,
    });
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'interaction.finalise',
      targetKind: 'conversation',
      targetId: conversationId,
      argsSanitized: { verdict: VERDICT_MARKER['fallback-created'] },
      result: 'succeeded',
    });
    return { conversationId, verdict: 'fallback-created', taskId: followUp.id };
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'interaction.finalise',
    targetKind: 'conversation',
    targetId: conversationId,
    argsSanitized: { verdict: VERDICT_MARKER['fallback-created'] },
    result: 'succeeded',
  });
  return { conversationId, verdict: 'fallback-created', taskId: task.id };
}

/** Alarm severity for an orphaned interaction after reconciliation (P07.11.03). */
export type OrphanSeverity = 'SEV2' | 'SEV1';

/**
 * Severity of a reconcile finding: any orphan after reconciliation is SEV2 (the invariant
 * needed the sweeper); a repeat — the same conversation orphaned on a previous sweep and
 * still orphaned — is SEV1 (the sweeper is not converging). `previouslySeen` is the set of
 * conversation ids a previous sweep reported; the scheduler owns it, this function only
 * classifies.
 */
export function orphanSeverity(
  previouslySeen: ReadonlySet<string>,
  conversationId: string,
): OrphanSeverity {
  return previouslySeen.has(conversationId) ? 'SEV1' : 'SEV2';
}

/** One orphaned interaction, named for the alarm. */
export interface OrphanFinalised {
  readonly organisationId: string;
  readonly conversationId: string;
  readonly verdict: FinaliseVerdict;
}

/** What one reconcile sweep did. `orphaned` is the `interactions.orphaned` metric value. */
export interface ReconcileReport {
  /** Tenants walked (the sweep's population, via the register). */
  readonly tenants: number;
  /** Orphans finalised by creating the fallback task. */
  readonly finalised: number;
  /** Tenants whose orphan check could not run. Not the same as clean. */
  readonly failed: number;
  /** Orphaned interactions found (fallback-created or already-finalised-by-racer). */
  readonly orphaned: number;
  readonly orphans: readonly OrphanFinalised[];
  /** onOrphan deliveries that threw after commit. Persisted work is intact; wiring must retry. */
  readonly deliveryErrors: number;
}

export interface ReconcileOrphansOptions {
  /** Age cutoff in minutes (default `ORPHAN_AFTER_MINUTES`). Narrowed in tests, never widened. */
  readonly olderThanMinutes?: number | undefined;
  /** Tenants per claim page (default `RECONCILE_PAGE_SIZE`). */
  readonly pageSize?: number | undefined;
  /** Called per finalised orphan, so the alarm fires without waiting for the whole sweep. */
  readonly onOrphan?: ((orphan: OrphanFinalised) => void) | undefined;
}

/**
 * Find this tenant's orphaned interactions: open past the cutoff with no outcome and no
 * open task. Runs inside `withTenant`, under the policy — the per-tenant half of the sweep.
 */
async function claimTenantOrphans(
  client: TenantClient,
  olderThanMinutes: number,
): Promise<string[]> {
  // The age clock is the latest activity on EITHER leg: call advances touch only
  // `calls.updated_at`, so a conversation whose call just moved must not read as orphaned
  // because `conversations.updated_at` sat still (query-side GREATEST — no P07.05 touch).
  const found = await client.query<{ id: string }>(
    `select c.id::text as id from conversations c
     where c.status in ('open', 'needs_action')
       and greatest(
         c.updated_at,
         coalesce(
           (select max(k.updated_at) from calls k
            where k.organisation_id = c.organisation_id and k.conversation_id = c.id),
           c.updated_at
         )
       ) <= clock_timestamp() - make_interval(mins => $1)
       and not exists (
         select 1 from interaction_outcomes o
         where o.organisation_id = c.organisation_id and o.conversation_id = c.id
       )
       and not exists (
         select 1 from tasks t
         where t.organisation_id = c.organisation_id and t.conversation_id = c.id
           and t.status in ('open', 'in_progress', 'waiting')
       )
     order by c.updated_at`,
    [olderThanMinutes],
  );
  return found.rows.map((row) => row.id);
}

/**
 * Sweep orphaned interactions across tenants.
 *
 * Population comes from the reviewed `app.claim_audit_chains` register (global, no RLS) —
 * a claim function over `conversations` cannot work: SECURITY DEFINER changes who runs it,
 * but FORCE RLS still applies to that user, and with no tenant context every owner sees
 * nothing (verified by probe). Each tenant's orphans are then checked inside `withTenant`
 * and finalised in the same transaction. One failing tenant does not abandon the rest.
 * Returns the report the caller turns into the `interactions.orphaned` metric and the
 * SEV2/SEV1 alarm.
 */
export async function reconcileOrphans(
  pool: Pool,
  options: ReconcileOrphansOptions = {},
): Promise<ReconcileReport> {
  const olderThan = options.olderThanMinutes ?? ORPHAN_AFTER_MINUTES;
  if (!Number.isInteger(olderThan) || olderThan < 1 || olderThan > 1440) {
    throw new RangeError('orphan age cutoff must be 1..1440 minutes');
  }
  const pageSize = options.pageSize ?? RECONCILE_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new RangeError('reconcile page size must be 1..1000');
  }
  const highWater = await registerHighWater(pool);
  const orphans: OrphanFinalised[] = [];
  let tenants = 0;
  let finalised = 0;
  let failed = 0;
  let deliveryErrors = 0;
  // Callbacks collected in-txn but delivered only after commit: invoking onOrphan inside
  // the tenant transaction would roll back the finalisations when the callback throws.
  const pendingDelivery: OrphanFinalised[] = [];
  let after = '0';
  for (;;) {
    const page = await claimTenantPage(pool, pageSize, after, highWater);
    if (page.tenants.length === 0) break;
    tenants += page.tenants.length;
    after = page.cursor;
    for (const organisationId of page.tenants) {
      try {
        await withTenant(pool, organisationId, async (client) => {
          for (const conversationId of await claimTenantOrphans(client, olderThan)) {
            const done = await finaliseInteraction(client, conversationId);
            if (done.verdict === 'fallback-created') finalised += 1;
            const orphan: OrphanFinalised = {
              organisationId,
              conversationId,
              verdict: done.verdict,
            };
            orphans.push(orphan);
            pendingDelivery.push(orphan);
          }
        });
      } catch {
        failed += 1;
      }
    }
    if (page.tenants.length < pageSize) break;
  }
  // Delivered after every commit: a throwing callback is counted, never rolled back.
  for (const orphan of pendingDelivery) {
    try {
      options.onOrphan?.(orphan);
    } catch {
      deliveryErrors += 1;
    }
  }
  return { tenants, finalised, failed, orphaned: orphans.length, orphans, deliveryErrors };
}

async function registerHighWater(pool: Pool): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      'select app.audit_chain_high_water()::text as n',
    );
    const value = (result.rows as { n: string }[])[0]?.n;
    if (value === undefined) throw new Error('audit chain high-water mark returned no row');
    return value;
  } finally {
    client.release();
  }
}

async function claimTenantPage(
  pool: Pool,
  pageSize: number,
  after: string,
  highWater: string,
): Promise<{ tenants: string[]; cursor: string }> {
  const client = await pool.connect();
  try {
    const result = await client.query<{
      organisation_id: string;
      registration_seq: string;
    }>(
      `select organisation_id::text, registration_seq::text
         from app.claim_audit_chains($1::integer, $2::bigint, $3::bigint)`,
      [pageSize, after, highWater],
    );
    const rows = result.rows as { organisation_id: string; registration_seq: string }[];
    return {
      tenants: rows.map((row) => row.organisation_id),
      cursor: rows.at(-1)?.registration_seq ?? after,
    };
  } finally {
    client.release();
  }
}
