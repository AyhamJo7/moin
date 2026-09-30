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
/** Advisory-lock name for the sweep, so two scheduled runs cannot overlap. */
const ADVISORY_LOCK_KEY = 'moin.verify_audit_chains';
/** Stop claiming new pages after this long, so an overrun is reported rather than killed silently. */
const SWEEP_DEADLINE_MS = 30 * 60 * 1000;

/**
 * The deadline, overridable by environment.
 *
 * It exists so the exit-code behaviour on a truncated sweep can be tested from outside the process,
 * which is the only place that behaviour is observable. A malformed or negative value falls back to
 * the default rather than disabling the deadline: this is an operational knob, not a way to turn the
 * coverage check off.
 */
function sweepPageSize(): number | undefined {
  const raw = process.env['MOIN_AUDIT_SWEEP_PAGE_SIZE'];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : undefined;
}

function sweepDeadlineMs(): number {
  const raw = process.env['MOIN_AUDIT_SWEEP_DEADLINE_MS'];
  if (raw === undefined) return SWEEP_DEADLINE_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : SWEEP_DEADLINE_MS;
}
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

/**
 * The application role, because that is the privilege level the chain must be intact at.
 *
 * Returns rather than exiting: `process.exit` does not flush an async stderr, so exiting from here
 * loses the explanation whenever stderr is a pipe — which is every scheduled-container case.
 */
function applicationConnectionString(): string | undefined {
  const value = process.env['DATABASE_URL'];
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * One JSON object per line, on stdout, with only allowlisted non-personal fields (INV-12).
 *
 * An audit event carries opaque identifiers and outcomes, never a name, a number or a payload, so
 * the fields below are safe by construction. They are written as JSON rather than prose because the
 * consumer is a log-metric filter that has to match them, and a sentence is not a contract.
 */
interface AlarmLine {
  readonly event: string;
  readonly severity?: 'SEV2' | 'SEV3';
  readonly outcome: string;
  readonly organisationId?: string;
  /** A SQLSTATE, or one of the verifier's fixed break reasons. Never a driver message. */
  readonly reason?: string;
  readonly seq?: string;
  readonly checked?: string;
  readonly count?: number;
  readonly sound?: number;
  readonly broken?: number;
  readonly unchecked?: number;
  readonly unreached?: number;
  readonly unregistered?: number;
  readonly durationMs?: number;
  readonly runbook?: string;
}

/**
 * The shape is closed on purpose.
 *
 * An open `Record<string, string | number>` is one commit away from "include the error detail so we
 * can triage faster", which passes lint, passes every test, and ships a driver message quoting its
 * input. A named field has to be added here, where the INV-12 question gets asked.
 */
function emit(line: AlarmLine): void {
  console.log(JSON.stringify(line));
}

/** SQLSTATE if the driver supplied one, else the error class. Never a message. */
function sqlState(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code)) return code;
  return error instanceof Error && error.name !== 'error' ? error.name : 'unknown';
}

async function verifyAudit(): Promise<number> {
  const connectionString = applicationConnectionString();
  if (connectionString === undefined) {
    console.error(
      'DATABASE_URL is not set. The audit verifier connects as the application role on purpose: ' +
        'a privileged connection would prove the chain is intact for a reader production does ' +
        'not have.',
    );
    return EXIT_FAILED;
  }

  // Bound once: `exactOptionalPropertyTypes` rejects a spread whose branch type still admits
  // `undefined`, which calling the accessor twice inside the ternary does.
  const pageSize = sweepPageSize();
  const pool = createPool({ connectionString, max: 4 });
  let report: AuditVerificationReport;
  const startedAt = Date.now();
  try {
    // One sweep at a time. A full verification is O(events that have ever existed), so it will one
    // day overrun its daily window; two overlapping sweeps would then double the load on the table
    // they are reading and neither would finish. The lock is session-scoped and released when this
    // process's connection closes, including on a crash.
    const lock = await pool.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)) as locked',
      [ADVISORY_LOCK_KEY],
    );
    if (lock.rows[0]?.locked !== true) {
      emit({
        event: 'audit.chain.run.skipped',
        severity: 'SEV3',
        outcome: 'already-running',
        runbook: 'docs/runbooks/audit-chain-break.md',
      });
      return EXIT_FAILED;
    }

    report = await verifyAuditChains(pool, {
      deadlineMs: sweepDeadlineMs(),
      ...(pageSize === undefined ? {} : { pageSize }),
      onIncompleteCoverage: (unreached) => {
        // The sweep ran out of time with tenants it never looked at. Not a break, but not a clean
        // day either: those chains are unverified and the report must not average them away.
        emit({
          event: 'audit.chain.run.incomplete',
          severity: 'SEV3',
          outcome: 'incomplete-coverage',
          unreached,
          runbook: 'docs/runbooks/audit-chain-break.md',
        });
      },
      onUnregistered: (organisationId) => {
        // Not a broken chain — a chain the sweep could not even know it should check. Same
        // severity as a break, because "no coverage" and "corrupted" are equally unacceptable
        // answers to "is the audit trail intact".
        emit({
          event: 'audit.chain.unregistered',
          severity: 'SEV2',
          outcome: 'unregistered',
          organisationId,
          runbook: 'docs/runbooks/audit-chain-break.md',
        });
      },
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
          // Not the message — it routinely quotes the input that caused it (INV-12) — and not
          // `name` either: `pg` sets that to the literal "error" for every database failure, so a
          // revoked grant and a dropped connection produced the identical alarm and the runbook's
          // first question was unanswerable. SQLSTATE is non-personal by construction and tells
          // 42501 (permission denied) from 57P01 (admin shutdown) immediately.
          reason: sqlState(failure.error),
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
      reason: sqlState(error),
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
    unreached: report.unreached,
    unregistered: report.unregistered,
    durationMs: Date.now() - startedAt,
  });

  // A sweep that walked nobody has verified nothing. On a database with tenants that means the
  // register is empty or unreadable, and "sound over zero tenants" is the single worst thing this
  // job could report — it is indistinguishable from a healthy day.
  if (report.tenants === 0) {
    emit({
      event: 'audit.chain.registry.empty',
      severity: 'SEV3',
      outcome: 'no-coverage',
      runbook: 'docs/runbooks/audit-chain-break.md',
    });
    return EXIT_FAILED;
  }

  if (report.broken > 0) return EXIT_CHAIN_BROKEN;
  // A tenant that is unchecked, absent from the register entirely, or never reached before the
  // deadline is a gap in today's coverage. `coverageComplete` is checked in its own right, because
  // a shortfall that could not even be counted reports `unreached: 0` and must still fail.
  if (report.unchecked > 0 || report.unregistered > 0 || !report.coverageComplete) {
    return EXIT_FAILED;
  }
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
    // Neither the message nor `error.name` (see `sqlState`): a server message names internal
    // objects and can quote the input that caused it, and stdout and stderr are collected together
    // by every container log driver, so the INV-12 guarantee has to hold on both (INV-15).
    console.error(`the command failed (${sqlState(error)}); see the runbook for this job`);
    return EXIT_FAILED;
  }
}

process.exitCode = await main();
