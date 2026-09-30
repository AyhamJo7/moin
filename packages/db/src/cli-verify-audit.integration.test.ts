/**
 * P06.10.05: the alarm the scheduler actually sees.
 *
 * The verifier's findings are only useful if the process that runs daily turns them into a signal
 * with the right severity, the right runbook and a distinguishing exit code. That is CLI behaviour,
 * so it is tested by running the CLI as a process rather than by calling into it — the exit code is
 * what the schedule gates on, and an exit code cannot be unit-tested from inside the process.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { appendAuditEvent } from './audit.ts';
import { withTenant } from './tenant.ts';

const run = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.ts');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const EXIT_CHAIN_BROKEN = 3;
const ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let database: TestDatabase;
let app: Pool;
let privileged: Pool;

interface CliResult {
  readonly code: number;
  readonly lines: readonly Record<string, unknown>[];
}

async function verifyAudit(): Promise<CliResult> {
  try {
    const { stdout } = await run(process.execPath, [CLI, 'verify-audit'], {
      cwd: REPO,
      env: { ...process.env, DATABASE_URL: database.appUrl },
    });
    return { code: 0, lines: parse(stdout) };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    return { code: failure.code ?? -1, lines: parse(failure.stdout ?? '') };
  }
}

function parse(stdout: string): Record<string, unknown>[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function lineFor(result: CliResult, event: string): Record<string, unknown> | undefined {
  return result.lines.find((line) => line['event'] === event);
}

beforeAll(async () => {
  database = await createTestDatabase('cli-verify-audit');
  privileged = createPool({ connectionString: database.migrationUrl, max: 1 });
  app = database.pool();
  await privileged.query(`insert into organisations(id, slug, name) values ($1, 'cli', 'CLI')`, [
    ORG,
  ]);
  await withTenant(app, ORG, (client) =>
    appendAuditEvent(client, {
      source: 'api',
      operation: 'test.checked',
      targetKind: 'organisation',
      targetId: randomUUID(),
      result: 'succeeded',
    }),
  );
}, 60_000);

afterAll(async () => {
  await privileged.end();
  await database.drop();
});

describe('the scheduled verifier process', () => {
  it('exits clean and reports a sound sweep', async () => {
    const result = await verifyAudit();
    expect(result.code).toBe(0);
    const completed = lineFor(result, 'audit.chain.run.completed');
    expect(completed).toMatchObject({
      outcome: 'sound',
      count: 1,
      sound: 1,
      broken: 0,
      unchecked: 0,
    });
    expect(lineFor(result, 'audit.chain.broken')).toBeUndefined();
  }, 60_000);

  it('raises a SEV2 alarm with its runbook and a distinct exit code on a break', async () => {
    await privileged.query('alter table audit_events disable trigger audit_events_append_only');
    try {
      await privileged.query(
        `update audit_events set result = 'failed' where organisation_id = $1 and seq = 1`,
        [ORG],
      );
    } finally {
      await privileged.query('alter table audit_events enable trigger audit_events_append_only');
    }

    const result = await verifyAudit();
    // 3, not 1: a broken chain and a verifier that could not run are different incidents, and a
    // database outage must not page anybody for suspected tampering.
    expect(result.code).toBe(EXIT_CHAIN_BROKEN);
    const alarm = lineFor(result, 'audit.chain.broken');
    expect(alarm).toMatchObject({
      severity: 'SEV2',
      outcome: 'broken',
      organisationId: ORG,
      reason: 'payload-mismatch',
      seq: '1',
      runbook: 'docs/runbooks/audit-chain-break.md',
    });
    expect(lineFor(result, 'audit.chain.run.completed')).toMatchObject({
      outcome: 'attention',
      broken: 1,
    });
  }, 60_000);

  it('emits only the reviewed non-personal fields on every line kind (INV-12)', async () => {
    // Every line kind has to be in this sample, not just the happy one: the field that leaks a
    // driver message is on the failure path, so a sweep with no failures proves nothing about it.
    await privileged.query(
      `revoke execute on function app.audit_canonical_payload(
         uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid,
         text, timestamptz) from moin_app`,
    );
    let result: CliResult;
    try {
      result = await verifyAudit();
    } finally {
      await privileged.query(
        `grant execute on function app.audit_canonical_payload(
           uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid,
           text, timestamptz) to moin_app`,
      );
    }
    // The sample must actually contain the line kinds this test is about.
    const unchecked = lineFor(result, 'audit.chain.unchecked');
    expect(unchecked).toBeDefined();
    expect(lineFor(result, 'audit.chain.run.completed')).toBeDefined();
    // A SQLSTATE, not `Error.name`: `pg` sets that to the literal "error" for every database
    // failure, which made a revoked grant and a dropped connection produce the same alarm and left
    // the runbook's first question unanswerable. 42501 is permission denied.
    expect(unchecked?.['reason']).toBe('42501');

    const allowed = new Set([
      'event',
      'severity',
      'outcome',
      'organisationId',
      'reason',
      'seq',
      'checked',
      'runbook',
      'count',
      'sound',
      'broken',
      'unchecked',
      'unreached',
      'populationHighWater',
      'unregistered',
      'durationMs',
    ]);
    const unexpected = result.lines.flatMap((line) =>
      Object.keys(line).filter((key) => !allowed.has(key)),
    );
    expect(unexpected).toStrictEqual([]);
    // Nothing that could carry a payload, a role name or a driver message reaches the log stream.
    // `permission denied for function …` is exactly the kind of message that names internals.
    expect(JSON.stringify(result.lines)).not.toMatch(
      /password|postgres:\/\/|moin_app|permission denied/u,
    );
  }, 60_000);

  it('refuses to call a sweep of zero tenants a clean run', async () => {
    // Its own database, with no tenants at all. "sound over zero tenants" is the single worst
    // thing this job could report: it is indistinguishable from a healthy day.
    const empty = await createTestDatabase('cli-verify-empty');
    try {
      const { stdout } = await run(process.execPath, [CLI, 'verify-audit'], {
        cwd: REPO,
        env: { ...process.env, DATABASE_URL: empty.appUrl },
      }).catch((error: unknown) => {
        const failure = error as { code?: number; stdout?: string };
        return { stdout: failure.stdout ?? '', code: failure.code };
      });
      const lines = parse(stdout);
      expect(lines.find((line) => line['event'] === 'audit.chain.registry.empty')).toMatchObject({
        outcome: 'no-coverage',
      });
      const completed = lines.find((line) => line['event'] === 'audit.chain.run.completed');
      expect(completed).toMatchObject({ count: 0 });
    } finally {
      await empty.drop();
    }
  }, 90_000);

  it('exits non-zero on a sweep of zero tenants', async () => {
    const empty = await createTestDatabase('cli-verify-empty-code');
    try {
      let code = 0;
      await run(process.execPath, [CLI, 'verify-audit'], {
        cwd: REPO,
        env: { ...process.env, DATABASE_URL: empty.appUrl },
      }).catch((error: unknown) => {
        code = (error as { code?: number }).code ?? -1;
      });
      expect(code).not.toBe(0);
    } finally {
      await empty.drop();
    }
  }, 90_000);

  it('fails and names the shortfall when the deadline truncates the sweep', async () => {
    // The process-level half of the deadline property. `MOIN_AUDIT_SWEEP_DEADLINE_MS` exists only
    // so this is testable from outside: a sweep that ran out of time has unverified chains, and the
    // exit code is what the schedule gates on.
    const many = await createTestDatabase('cli-verify-deadline');
    const owner = createPool({ connectionString: many.migrationUrl, max: 1 });
    try {
      await owner.query(
        `insert into organisations(id, slug, name)
         select gen_random_uuid(), 'deadline-' || g, 'Deadline ' || g from generate_series(1, 6) g`,
      );
      let code = 0;
      let stdout = '';
      await run(process.execPath, [CLI, 'verify-audit'], {
        cwd: REPO,
        env: {
          ...process.env,
          DATABASE_URL: many.appUrl,
          // One tenant per page; the deadline expires as soon as that page is done, so five of the
          // six tenants are never reached.
          MOIN_AUDIT_SWEEP_PAGE_SIZE: '1',
          MOIN_AUDIT_SWEEP_DEADLINE_MS: '0',
        },
      })
        .then(({ stdout: out }) => {
          stdout = out;
        })
        .catch((error: unknown) => {
          const failure = error as { code?: number; stdout?: string };
          code = failure.code ?? -1;
          stdout = failure.stdout ?? '';
        });

      const lines = parse(stdout);
      expect(code).not.toBe(0);
      expect(lines.find((line) => line['event'] === 'audit.chain.run.incomplete')).toMatchObject({
        outcome: 'incomplete-coverage',
        unreached: 5,
      });
      expect(lines.find((line) => line['event'] === 'audit.chain.run.completed')).toMatchObject({
        outcome: 'attention',
        count: 1,
        unreached: 5,
      });
    } finally {
      await owner.end();
      await many.drop();
    }
  }, 120_000);

  it('fails when it cannot even establish whether coverage was complete', async () => {
    // The narrow case that isolates the coverage check from the unchecked count: the shortfall
    // cannot be counted, so `unreached` is 0 and `unchecked` is 0, and the only thing that makes
    // this a failed run is that completeness is unknown. Not knowing is not the same as complete.
    const opaque = await createTestDatabase('cli-verify-uncountable');
    const owner = createPool({ connectionString: opaque.migrationUrl, max: 1 });
    try {
      await owner.query(
        `insert into organisations(id, slug, name)
         select gen_random_uuid(), 'opaque-' || g, 'Opaque ' || g from generate_series(1, 3) g`,
      );
      await owner.query(
        'revoke execute on function app.count_audit_chains(bigint, bigint) from moin_app',
      );

      let code = 0;
      let stdout = '';
      await run(process.execPath, [CLI, 'verify-audit'], {
        cwd: REPO,
        env: {
          ...process.env,
          DATABASE_URL: opaque.appUrl,
          // One tenant per page, and the deadline expires the moment that page is done. So exactly
          // one tenant is verified, tenants is non-zero, and — with the count function revoked —
          // the shortfall cannot be established. `unchecked` is therefore 0 and the run is unsound
          // only because completeness is unknown, which is the term this isolates.
          MOIN_AUDIT_SWEEP_PAGE_SIZE: '1',
          MOIN_AUDIT_SWEEP_DEADLINE_MS: '0',
        },
      })
        .then(({ stdout: out }) => {
          stdout = out;
        })
        .catch((error: unknown) => {
          const failure = error as { code?: number; stdout?: string };
          code = failure.code ?? -1;
          stdout = failure.stdout ?? '';
        });

      const lines = parse(stdout);
      const completed = lines.find((line) => line['event'] === 'audit.chain.run.completed');
      // Nothing broken, nothing unchecked, no shortfall counted, tenants > 0 — and still not a
      // clean run, because whether it covered everything is unknown.
      expect(completed).toMatchObject({ count: 1, broken: 0, unchecked: 0, unreached: 0 });
      expect(lines.find((line) => line['event'] === 'audit.chain.run.incomplete')).toBeDefined();
      expect(code).not.toBe(0);
    } finally {
      await owner.end();
      await opaque.drop();
    }
  }, 120_000);

  it('reports a failure rather than a clean run when it cannot enumerate tenants', async () => {
    await privileged.query(
      'revoke execute on function app.claim_audit_chains(integer, bigint, bigint) from moin_app',
    );
    try {
      const result = await verifyAudit();
      expect(result.code).toBe(1);
      expect(lineFor(result, 'audit.chain.run.failed')).toMatchObject({ outcome: 'failed' });
      // The decisive assertion: it must not look like a successful sweep of zero tenants.
      expect(lineFor(result, 'audit.chain.run.completed')).toBeUndefined();
    } finally {
      await privileged.query(
        'grant execute on function app.claim_audit_chains(integer, bigint, bigint) to moin_app',
      );
    }
  }, 60_000);
});
