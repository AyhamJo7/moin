/**
 * `pnpm db:migrate`, `pnpm db:seed` and `pnpm db:verify-audit`.
 *
 * `migrate` and `seed` read the migration connection string, not the application one: migrations run
 * as the role that is allowed to issue DDL, and the application role deliberately is not
 * (ADR-0003, INV-01).
 *
 * `verify-audit` is the opposite, and deliberately so. It is the daily chain verifier (P06.10.05)
 * and it connects as the **application** role, so that what it proves is what production can see:
 * verifying a chain through a privileged connection would prove the chain is intact for somebody
 * who is not subject to the policies the chain lives behind.
 */

import { migrate } from './migrate.ts';
import { seed } from './seed.ts';
import { createPool } from './pool.ts';
import { isSound, verifyAuditChains, type AuditVerificationReport } from './audit-verification.ts';

/**
 * Exit codes are a contract with whatever schedules this.
 *
 * A broken chain and a verifier that could not run are different incidents with different runbook
 * entries, so they get different codes: the scheduler routes a SEV2 integrity alarm on
 * `EXIT_CHAIN_BROKEN` and an ordinary job-failure alert on `EXIT_FAILED`. Collapsing them would
 * mean a database outage paging someone for suspected tampering.
 */
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_CHAIN_BROKEN = 3;

function connectionString(): string {
  const value = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];
  if (value === undefined || value.length === 0) {
    console.error(
      'DATABASE_MIGRATION_URL is not set (DATABASE_URL is used as a fallback). ' +
        'Copy .env.example to .env — every value in it is a development-only fake.',
    );
    process.exit(1);
  }
  return value;
}

/** The application role, because that is the privilege level the chain must be intact at. */
function applicationConnectionString(): string {
  const value = process.env['DATABASE_URL'];
  if (value === undefined || value.length === 0) {
    console.error(
      'DATABASE_URL is not set. The audit verifier connects as the application role on purpose: ' +
        'a privileged connection would prove the chain is intact for a reader production does ' +
        'not have.',
    );
    process.exit(EXIT_FAILED);
  }
  return value;
}

/**
 * One JSON object per line, on stdout, with only allowlisted non-personal fields (INV-12).
 *
 * An audit event carries opaque identifiers and outcomes, never a name, a number or a payload, so
 * the fields below are safe by construction. They are written as JSON rather than prose because the
 * consumer is a log-metric filter that has to match them, and a sentence is not a contract.
 */
function emit(line: Record<string, string | number>): void {
  console.log(JSON.stringify(line));
}

async function verifyAudit(): Promise<number> {
  const pool = createPool({ connectionString: applicationConnectionString(), max: 4 });
  let report: AuditVerificationReport;
  const startedAt = Date.now();
  try {
    report = await verifyAuditChains(pool, {
      // Emitted as each one is found rather than at the end: a sweep over many tenants that is
      // killed halfway must still have alarmed on what it already saw.
      onBreak: (found) => {
        emit({
          event: 'audit.chain.broken',
          severity: 'SEV2',
          outcome: 'broken',
          organisationId: found.organisationId,
          reason: found.reason,
          seq: found.seq,
          checked: found.checked,
          runbook: 'docs/runbooks/audit-chain-break.md',
        });
      },
      onFailure: (failure) => {
        emit({
          event: 'audit.chain.unchecked',
          severity: 'SEV3',
          outcome: 'unchecked',
          organisationId: failure.organisationId,
          // The error message is not echoed: it routinely quotes the input that caused it (INV-12).
          reason: failure.error instanceof Error ? failure.error.name : 'unknown',
          runbook: 'docs/runbooks/audit-chain-break.md',
        });
      },
    });
  } catch (error) {
    // A sweep that could not enumerate tenants has verified nothing, and must never be reported as
    // a clean run just because it produced no breaks.
    emit({
      event: 'audit.chain.run.failed',
      severity: 'SEV3',
      outcome: 'failed',
      reason: error instanceof Error ? error.name : 'unknown',
      runbook: 'docs/runbooks/audit-chain-break.md',
    });
    return EXIT_FAILED;
  } finally {
    await pool.end();
  }

  emit({
    event: 'audit.chain.run.completed',
    outcome: isSound(report) ? 'sound' : 'attention',
    count: report.tenants,
    sound: report.sound,
    broken: report.broken,
    unchecked: report.unchecked,
    durationMs: Date.now() - startedAt,
  });

  if (report.broken > 0) return EXIT_CHAIN_BROKEN;
  // An unchecked tenant is not a clean run: it is a gap in today's coverage.
  if (report.unchecked > 0) return EXIT_FAILED;
  return EXIT_OK;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  try {
    if (command === 'migrate') {
      const outcome = await migrate(connectionString());
      console.log(
        outcome.applied.length === 0
          ? `nothing to apply (${String(outcome.alreadyApplied)} migration(s) already applied)`
          : `applied ${String(outcome.applied.length)}: ${outcome.applied.join(', ')}`,
      );
      return EXIT_OK;
    }
    if (command === 'seed') {
      const outcome = await seed(connectionString());
      console.log(`seeded ${String(outcome.applied)} row(s)`);
      for (const note of outcome.skipped) console.log(`  skipped — ${note}`);
      return EXIT_OK;
    }
    if (command === 'verify-audit') {
      return await verifyAudit();
    }
    console.error('usage: db migrate | db seed | db verify-audit');
    return EXIT_USAGE;
  } catch (error) {
    // The connection string can carry a password, so the driver's message is not echoed (INV-15).
    console.error(error instanceof Error ? error.message : 'the command failed');
    return EXIT_FAILED;
  }
}

process.exitCode = await main();
