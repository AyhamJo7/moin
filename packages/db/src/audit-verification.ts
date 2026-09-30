/**
 * The daily audit chain verifier (P06.10.05, INV-10).
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

/** Tenants per claim page. The SQL function caps itself at 1000; this stays well under it. */
const CHAIN_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 1000;

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
  readonly breaks: readonly AuditChainBreak[];
  readonly failures: readonly AuditChainFailure[];
}

export interface VerifyAuditChainsOptions {
  /** Called as each break is found, so the alarm fires without waiting for the whole sweep. */
  readonly onBreak?: (found: AuditChainBreak) => void;
  /** Called for a tenant whose chain could not be checked. */
  readonly onFailure?: (failure: AuditChainFailure) => void;
  /** Tenants per claim page. Defaults to 200; only tests need to shrink it. */
  readonly pageSize?: number;
}

/** A run that checked everything it listed and found nothing wrong. */
export function isSound(report: AuditVerificationReport): boolean {
  return report.broken === 0 && report.unchecked === 0;
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

  const breaks: AuditChainBreak[] = [];
  const failures: AuditChainFailure[] = [];
  let tenants = 0;
  let sound = 0;
  let after: string | null = null;

  for (;;) {
    // Captured from the claim itself rather than re-queried: asking the database a second time for
    // "the last id of that page" would race with a provisioning landing mid-sweep.
    let page: readonly ClaimedItem[] = [];

    const result = await withSystemWork(
      pool,
      async (client: TenantClient) => {
        const claimed = await client.query<{ organisation_id: string; id: string }>(
          'select organisation_id, id from app.claim_audit_chains($1::integer, $2::uuid)',
          [pageSize, after],
        );
        page = claimed.rows.map((row) => ({
          organisationId: row.organisation_id,
          id: row.id,
        }));
        return page;
      },
      async (item: ClaimedItem, client: TenantClient) => {
        const outcome = await verifyAuditChain(client);
        if (outcome.valid) {
          sound += 1;
          return;
        }
        const found: AuditChainBreak = {
          organisationId: item.organisationId,
          reason: outcome.reason,
          seq: outcome.seq,
          checked: outcome.checked,
        };
        breaks.push(found);
        options.onBreak?.(found);
      },
      (item: ClaimedItem, error: unknown) => {
        const failure: AuditChainFailure = { organisationId: item.organisationId, error };
        failures.push(failure);
        options.onFailure?.(failure);
      },
    );

    tenants += result.claimed;
    const last = page.at(-1);
    // A short page is the last page. `last === undefined` covers an empty register.
    if (result.claimed < pageSize || last === undefined) break;
    after = last.organisationId;
  }

  return { tenants, sound, broken: breaks.length, unchecked: failures.length, breaks, failures };
}
