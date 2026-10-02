/**
 * The daily audit chain verifier (P06.10.05, INV-10).
 *
 * ## What a sound report claims, precisely
 *
 * **Sound for the register population captured at sweep start** — not "sound right now". The sweep
 * reads the register's high-water mark once, and its population is exactly the registrations at or
 * below it. A tenant registered while the sweep is running belongs to the next one.
 *
 * That boundary is explicit because the alternative was silently wrong. Paging by `tenant_id` — a
 * random UUID — meant a registration landing behind the cursor was invisible: measured, a register
 * holding one tenant, a sweep whose cursor had passed it, a second tenant registered, and then
 * "next page: 0 rows, count after cursor: 0, unregistered: 0" — a complete-coverage report over
 * half the estate. UUID order does not encode registration order, so no cursor over it can
 * distinguish "nothing left" from "something arrived behind me", and counting cannot either,
 * because a late tenant ahead of the cursor gets processed and pushes the total up while an
 * original member is still unvisited.
 *
 * Continuous-current soundness would need the whole sweep inside one snapshot, and a REPEATABLE
 * READ transaction spanning every tenant's chain would pin `xmin` on the fastest-growing table in
 * the schema for the duration. A captured population is achievable, cheap, and says what it means.
 *
 * ## What this adds over `verifyAuditChain`
 *
 * `verifyAuditChain` answers the question for *one* tenant, inside a transaction the caller already
 * opened. That is the right shape for a support tool and the wrong shape for an alarm: the break
 * that matters is the one in a tenant nobody looked at. This walks every registered tenant, one
 * tenant transaction per chain, and reports what it found.
 *
 * ## A break is a result, not an exception
 *
 * A broken chain is not an error — it is the finding this job exists to produce. It is collected
 * and returned, and the sweep continues, because a verifier that throws on the first break tells
 * you about exactly one tenant and leaves every other chain unchecked.
 *
 * A tenant whose chain could not be *attempted* is counted separately. "Verified and sound" and
 * "not verified" must never collapse into the same number, which is why `unchecked` exists and why
 * `isSound` refuses a run that has any.
 *
 * ## Why the alarm is a callback
 *
 * The signal has to reach a log line, a metric and eventually a CloudWatch alarm, and none of those
 * belong in `@moin/db`: a data package that imports the telemetry stack is a data package that
 * cannot be tested without it. The caller supplies `onBreak` / `onFailure`, so this module stays
 * deterministic and the wiring stays where the logger already lives.
 *
 * ## Determinism
 *
 * Tenants are walked in identifier order, paged by key, so the same database produces the same
 * report in the same order. That is what makes the negative controls assertable rather than flaky.
 */

import { verifyAuditChain } from './audit.ts';
import { withSystemWork, type ClaimedItem, type TenantClient } from './tenant.ts';
import type { Pool } from './pool.ts';

/** Where a sweep starts paging: before the first registration. */
const FIRST_CURSOR = '0';

/** Tenants per claim page. The SQL function caps itself at 1000; this stays well under it. */
const CHAIN_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 1000;
/** How many unregistered tenants to name before the report simply says there are more. */
const UNREGISTERED_SAMPLE = 100;

/** A chain that did not verify, named by tenant and by where the walk stopped. */
export interface AuditChainBreak {
  readonly organisationId: string;
  /** `missing-head`, `missing-event`, `sequence-gap`, `previous-hash`, `payload-mismatch`, … */
  readonly reason: string;
  /** The sequence the break was found at. */
  readonly seq: string;
  /** How many events verified before it. */
  readonly checked: string;
}

/** A tenant whose chain could not be checked at all. Not the same as a sound chain. */
export interface AuditChainFailure {
  readonly organisationId: string;
  readonly error: unknown;
}

export interface AuditVerificationReport {
  /** Registered tenants walked. */
  readonly tenants: number;
  /** Tenants whose chain verified. */
  readonly sound: number;
  /** Tenants whose chain is broken. */
  readonly broken: number;
  /** Tenants whose chain could not be checked. */
  readonly unchecked: number;
  /**
   * The register high-water mark this sweep's population was captured at.
   *
   * Reported so a reader can see which population the verdict covers, and so two consecutive runs
   * can be shown to have no gap between them.
   */
  readonly populationHighWater: string;
  /**
   * Members of the captured population the sweep never claimed.
   *
   * Counted from the **register**, inside the captured range. Deriving it from the tenants that
   * were claimed is fail-open twice over: every claimed tenant is also processed, so the
   * subtraction is zero; and a registration behind a UUID cursor is invisible to it entirely.
   */
  readonly unreached: number;
  /**
   * True only when every member of the captured population was verified or reported.
   *
   * False when the deadline fired with members still ahead of the cursor, and false when the
   * shortfall could not be established at all — not knowing whether coverage was complete is not
   * the same as it being complete. It says nothing about registrations made after the snapshot,
   * which are not this sweep's to cover.
   */
  readonly coverageComplete: boolean;
  /**
   * Provisioned tenants missing from the register — tenants the sweep could not even know about.
   *
   * Without this the register is its own witness: a registration trigger disabled and re-enabled
   * around one insert leaves nothing in the catalog to find afterwards, and that tenant's chain
   * would read as "not there" rather than "not checked" forever.
   */
  readonly unregistered: number;
  readonly breaks: readonly AuditChainBreak[];
  readonly failures: readonly AuditChainFailure[];
  /** Up to `UNREGISTERED_SAMPLE` identifiers of unregistered tenants, for the alarm. */
  readonly unregisteredTenants: readonly string[];
}

export interface VerifyAuditChainsOptions {
  /** Called as each break is found, so the alarm fires without waiting for the whole sweep. */
  readonly onBreak?: (found: AuditChainBreak) => void;
  /** Called for a tenant whose chain could not be checked. */
  readonly onFailure?: (failure: AuditChainFailure) => void;
  /** Called for a provisioned tenant that is missing from the register. */
  readonly onUnregistered?: (organisationId: string) => void;
  /** Called once when the deadline fired with tenants still unreached. */
  readonly onIncompleteCoverage?: (unreached: number) => void;
  /**
   * Called after each page is processed, with the running tenant count.
   *
   * A progress hook for long sweeps — and the seam that makes the population boundary testable
   * without an injectable snapshot. The snapshot must be a correctness property of the sweep, not
   * something a caller or an operator can set, so there is deliberately no way to supply the
   * high-water mark from outside; a test instead registers a tenant *from* this callback and
   * asserts the running sweep does not adopt it.
   */
  readonly onPageComplete?: (tenants: number) => void | Promise<void>;
  /** Tenants per claim page. Defaults to 200; only tests need to shrink it. */
  readonly pageSize?: number;
  /**
   * Stop claiming new pages after this many milliseconds.
   *
   * The chain is never truncated, so a full sweep is O(events that have ever existed) and grows
   * every day. Without a bound it eventually overruns its own daily window, two sweeps overlap, and
   * a run killed by the scheduler reports nothing at all. Tenants not reached are counted
   * `unchecked`, so overrunning shows up as a coverage gap rather than as silence.
   */
  readonly deadlineMs?: number;
  /** Injected for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * A run that covered every tenant there is and found nothing wrong.
 *
 * Four things have to hold, and each of them has been a fail-open bug at some point in this file's
 * history: nothing broken, nothing unchecked, no provisioned tenant missing from the register, and
 * the sweep known to have reached the end of it. A sweep that verified nothing must never read as a
 * sweep that found nothing wrong.
 */
export function isSound(report: AuditVerificationReport): boolean {
  return (
    report.broken === 0 &&
    report.unchecked === 0 &&
    report.unregistered === 0 &&
    report.coverageComplete
  );
}

/**
 * Verify every registered tenant's audit chain.
 *
 * Resolves rather than rejects when chains are broken: the report is the product. It rejects only
 * when the tenant register itself cannot be read, because a run that could not enumerate tenants
 * has verified nothing and must not be mistaken for a clean one.
 */
export async function verifyAuditChains(
  pool: Pool,
  options: VerifyAuditChainsOptions = {},
): Promise<AuditVerificationReport> {
  const pageSize = options.pageSize ?? CHAIN_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error('invalid audit verification page size');
  }
  const now = options.now ?? Date.now;
  const startedAt = now();

  // Captured **once**, before the first page. Every page and every coverage calculation below uses
  // this same value; recomputing it per page would reopen the defect from the other side, by
  // letting the population grow underneath the sweep that is meant to be bounded by it.
  const highWater = await populationHighWater(pool);

  const breaks: AuditChainBreak[] = [];
  const failures: AuditChainFailure[] = [];
  /**
   * One entry per tenant, written when its chain is walked and removed if the surrounding
   * transaction then fails to commit.
   *
   * The counters used to be incremented inside the `process` callback, which runs *before*
   * `withTenant` commits. A commit that then failed called `onFailure` as well, so one tenant was
   * counted both sound and unchecked and the totals could exceed the tenant count — a report whose
   * own arithmetic contradicted the property it exists to state.
   */
  const outcomes = new Map<string, 'sound' | 'broken'>();
  let tenants = 0;
  /** Registration sequence already covered. Sequence order, never UUID order. */
  let after = FIRST_CURSOR;
  let deadlineReached = false;

  for (;;) {
    // Captured from the claim itself rather than re-queried: asking the database a second time for
    // "the last row of that page" would race with a registration landing mid-sweep.
    let page: readonly ClaimedItem[] = [];
    let cursor = after;

    const result = await withSystemWork(
      pool,
      async (client: TenantClient) => {
        const claimed = await client.query<{
          organisation_id: string;
          id: string;
          registration_seq: string;
        }>(
          `select organisation_id, id, registration_seq::text as registration_seq
             from app.claim_audit_chains($1::integer, $2::bigint, $3::bigint)`,
          [pageSize, after, highWater],
        );
        cursor = claimed.rows.at(-1)?.registration_seq ?? cursor;
        page = claimed.rows.map((row) => ({
          organisationId: row.organisation_id,
          id: row.id,
        }));
        return page;
      },
      async (item: ClaimedItem, client: TenantClient) => {
        const outcome = await verifyAuditChain(client);
        if (outcome.valid) {
          outcomes.set(item.organisationId, 'sound');
          return;
        }
        const found: AuditChainBreak = {
          organisationId: item.organisationId,
          reason: outcome.reason,
          seq: outcome.seq,
          checked: outcome.checked,
        };
        outcomes.set(item.organisationId, 'broken');
        breaks.push(found);
        options.onBreak?.(found);
      },
      (item: ClaimedItem, error: unknown) => {
        // The walk may have completed and the commit still failed, so any outcome recorded for this
        // tenant is withdrawn: it was not verified.
        outcomes.delete(item.organisationId);
        const failure: AuditChainFailure = { organisationId: item.organisationId, error };
        failures.push(failure);
        options.onFailure?.(failure);
      },
    );

    tenants += result.claimed;
    await options.onPageComplete?.(tenants);
    // An empty page always ends the sweep. `result.claimed < pageSize` covers this for any sane
    // page size; this is the belt: a page size of 0 would otherwise satisfy neither condition and
    // the loop would spin for ever on a claim that returns nothing.
    if (result.claimed === 0) break;
    // A short page is the last page of the captured population; an empty one means the sweep has
    // reached the high-water mark. Either way there is nothing further *in this population*, which
    // is a statement the sequence bound makes safe to act on.
    if (result.claimed < pageSize) break;
    after = cursor;

    // The deadline is checked here rather than at the top of the loop, so a sweep always claims at
    // least one page. A run that exits having verified nothing because its deadline had already
    // expired is strictly worse than one that verifies a page and reports the shortfall, and the
    // deadline's job is to stop claiming *further* pages rather than to cancel the sweep.
    if (options.deadlineMs !== undefined && now() - startedAt >= options.deadlineMs) {
      deadlineReached = true;
      break;
    }
  }

  // How many registered tenants are still ahead of the cursor. Asked of the register, because the
  // worklist cannot answer it: every tenant the sweep claimed was also processed, so subtracting
  // outcomes from claims yields zero whether or not anything remains.
  let unreached = 0;
  let coverageComplete = true;
  if (deadlineReached) {
    try {
      unreached = await remaining(pool, after, highWater);
    } catch {
      // Not knowing the shortfall is not the same as there being none. Fail closed, and let the
      // count stay 0 rather than inventing one.
      coverageComplete = false;
    }
    if (unreached > 0) coverageComplete = false;
    if (!coverageComplete) options.onIncompleteCoverage?.(unreached);
  }

  const unregisteredTenants = await unregistered(pool);
  for (const organisationId of unregisteredTenants) {
    options.onUnregistered?.(organisationId);
  }

  let sound = 0;
  let broken = 0;
  for (const outcome of outcomes.values()) {
    if (outcome === 'sound') sound += 1;
    else broken += 1;
  }

  return {
    tenants,
    sound,
    broken,
    populationHighWater: highWater,
    // A tenant the deadline stopped us reaching is unchecked, not absent.
    unchecked: failures.length + unreached,
    unreached,
    coverageComplete,
    unregistered: unregisteredTenants.length,
    breaks,
    failures,
    unregisteredTenants,
  };
}

/**
 * The register high-water mark, read once per sweep.
 *
 * Rejects rather than defaulting: a sweep that does not know its own population bound cannot
 * report on coverage at all, and a silent 0 would make every register look empty.
 */
async function populationHighWater(pool: Pool): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      'select app.audit_chain_high_water()::text as n',
    );
    const value = result.rows[0]?.n;
    if (value === undefined) throw new Error('audit chain high-water mark returned no row');
    return value;
  } finally {
    client.release();
  }
}

/** Population members still unvisited — a count only, never identifiers. */
async function remaining(pool: Pool, after: string, highWater: string): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ n: string }>(
      'select app.count_audit_chains($1::bigint, $2::bigint)::text as n',
      [after, highWater],
    );
    const value = result.rows[0]?.n;
    if (value === undefined) throw new Error('audit chain count returned no row');
    return Number(value);
  } finally {
    client.release();
  }
}

/**
 * Provisioned tenants with no register row.
 *
 * Rejects rather than returning empty on failure, for the same reason the claim does: a
 * reconciliation that could not run has reconciled nothing.
 */
async function unregistered(pool: Pool): Promise<readonly string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ id: string }>(
      'select id from app.unregistered_audit_chains($1::integer)',
      [UNREGISTERED_SAMPLE],
    );
    return result.rows.map((row) => row.id);
  } finally {
    client.release();
  }
}
