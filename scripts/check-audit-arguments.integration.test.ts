/**
 * The audit argument scanner, checked (P06.10.07).
 *
 * Each case writes the leak it is meant to find. Rows that the reviewed writer would reject are
 * inserted around it — with the append-only trigger disabled and as the privileged role — because
 * the scanner's purpose is precisely to find what did *not* come through the writer.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { createPool, type Pool } from '@moin/db/pool';
import { appendAuditEvent, withTenant } from '@moin/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scan, type Finding } from './check-audit-arguments.ts';

const ORG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const runProcess = promisify(execFile);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-audit-arguments.ts');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Runs the check as the process a CI job or a schedule would run, for its exit code. */
async function runCheck(url: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await runProcess(process.execPath, [SCRIPT, '--url', url], {
      cwd: REPO,
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, out: (failure.stdout ?? '') + (failure.stderr ?? '') };
  }
}

let database: TestDatabase;
let privileged: Pool;
let app: Pool;

/**
 * The scan runs as the **application role**, not as the admin connection.
 *
 * The first version of this test used `database.migrationUrl`, which `packages/testing` builds from
 * the admin URL — the local bootstrap superuser, which bypasses RLS. That made a check that returns
 * zero rows under every production role look like a working control. Driving it as `moin_app` is
 * the whole point.
 */
async function findings(): Promise<Finding[]> {
  const result = await scan(database.appUrl);
  // A scan that inspected nothing cannot have found anything, so every assertion below would pass
  // vacuously. Fail loudly instead.
  expect(result.tenants).toBeGreaterThan(0);
  expect(result.events).toBeGreaterThan(0);
  return [...result.findings];
}

function rulesFor(list: readonly Finding[], subject: string): string[] {
  return list
    .filter((finding) => finding.subject === subject)
    .map((finding) => finding.rule)
    .sort();
}

/**
 * Writes an event the reviewed writer would refuse, the way a restore would.
 *
 * The `audit_events_linked_only` guard now rejects an unlinked insert, so forging requires
 * disabling it — which is exactly what `pg_restore --disable-triggers` does, and is the path this
 * scanner exists to catch.
 */
async function forge(operation: string, args: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify(args);
  await privileged.query('alter table audit_events disable trigger audit_events_linked_only');
  try {
    await forgeRow(operation, payload);
  } finally {
    await privileged.query(
      'alter table audit_events enable always trigger audit_events_linked_only',
    );
  }
}

async function forgeRow(operation: string, payload: string): Promise<void> {
  await privileged.query(
    `insert into audit_events(
       organisation_id, id, seq, prev_hash, hash, source, operation, target_kind,
       result, args_sanitized, created_at, canonical_payload)
     values ($1, $2, (select coalesce(max(seq), 0) + 1 from audit_events where organisation_id = $1),
       decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'),
       'api', $3, 'organisation', 'succeeded', $4::jsonb, now(), 'forged')`,
    [ORG, randomUUID(), operation, payload],
  );
}

beforeAll(async () => {
  database = await createTestDatabase('audit-arguments');
  privileged = createPool({ connectionString: database.migrationUrl, max: 1 });
  app = database.pool();
  await privileged.query(`insert into organisations(id, slug, name) values ($1, 'args', 'Args')`, [
    ORG,
  ]);
  await privileged.query(
    `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
     values ('test.scan', 'related_id', 'uuid', 'opaque reference only'),
            ('test.scan', 'was_confirmed', 'boolean', 'outcome flag'),
            ('test.scan', 'item_count', 'count', 'bounded count')`,
  );
}, 60_000);

afterAll(async () => {
  await privileged.end();
  await database.drop();
});

describe('the scanner on a trail the writer produced', () => {
  it('reports nothing for reviewed keys and opaque values', async () => {
    await withTenant(app, ORG, (client) =>
      appendAuditEvent(client, {
        source: 'api',
        operation: 'test.scan',
        targetKind: 'organisation',
        result: 'succeeded',
        argsSanitized: { related_id: randomUUID(), was_confirmed: true, item_count: 3 },
      }),
    );
    expect(await findings()).toStrictEqual([]);
  });
});

describe('what the scanner catches', () => {
  it('a name, which no pattern would predict, by the structural rule', async () => {
    await forge('test.scan', { related_id: 'Gurlitt Sanitär GmbH' });
    const list = await findings();
    expect(rulesFor(list, 'test.scan.related_id')).toStrictEqual(['free-text-argument']);
    // A check that quotes what it found is the leak it was written to prevent (INV-12).
    const reported = list.map((finding) => `${finding.subject} ${finding.detail}`).join(' ');
    expect(reported).not.toMatch(/Gurlitt|Sanitär/u);
  });

  it('a contact detail, named as such', async () => {
    await forge('test.scan', { related_id: 'kundin@example.test' });
    await forge('test.scan', { related_id: '+49 170 1234567' });
    const list = await findings();
    const rules = rulesFor(list, 'test.scan.related_id');
    expect(rules).toContain('personal-data-in-argument');
    // The finding must not quote the value it found, or the check becomes the leak.
    const detail = list.map((finding) => finding.detail).join(' ');
    expect(detail).not.toMatch(/kundin@example\.test|1234567/u);
  });

  it('a key that never passed the writer at all', async () => {
    await forge('test.scan', { caller_number: randomUUID() });
    expect(rulesFor(await findings(), 'test.scan.caller_number')).toStrictEqual([
      'unregistered-argument-key',
    ]);
  });

  it('a value kind the registry was widened to accept', async () => {
    // The CHECK constraint has to go first, which is the point: a migration that widens the kinds
    // is a one-line change that reads as harmless.
    await privileged.query(
      `alter table audit_argument_allowlist drop constraint audit_argument_allowlist_value_kind_check`,
    );
    try {
      await privileged.query(
        `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
         values ('test.scan', 'note', 'text', 'free text, which is the thing we do not allow')`,
      );
      expect(rulesFor(await findings(), 'test.scan.note')).toStrictEqual(['unreviewed-value-kind']);
    } finally {
      await privileged.query(
        `delete from audit_argument_allowlist where operation = 'test.scan' and argument_key = 'note'`,
      );
      await privileged.query(
        `alter table audit_argument_allowlist add constraint audit_argument_allowlist_value_kind_check
           check (value_kind in ('uuid', 'boolean', 'count'))`,
      );
    }
  });

  it('a validation entry carrying something other than a bounded scalar', async () => {
    await privileged.query('alter table audit_events disable trigger audit_events_linked_only');
    await privileged.query(
      `insert into audit_events(
         organisation_id, id, seq, prev_hash, hash, source, operation, target_kind,
         result, validation, created_at, canonical_payload)
       values ($1, $2, (select coalesce(max(seq), 0) + 1 from audit_events where organisation_id = $1),
         decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'),
         'api', 'test.scan', 'organisation', 'succeeded',
         '{"reason": "Kundin hat abgelehnt"}'::jsonb, now(), 'forged')`,
      [ORG, randomUUID()],
    );
    await privileged.query(
      'alter table audit_events enable always trigger audit_events_linked_only',
    );
    expect(rulesFor(await findings(), 'test.scan.reason')).toStrictEqual([
      'non-scalar-validation-value',
    ]);
  });

  it('a forged argument key that is itself personal data, without printing it', async () => {
    // `args_sanitized` has no key-level CHECK, so a row that bypassed the writer can carry a key
    // that *is* the leak. Printing the subject verbatim would make this check the disclosure.
    await forge('test.scan', { 'hans.mueller@example.test': true });
    const list = await findings();
    const reported = list.map((f) => `${f.subject} ${f.detail}`).join(' ');
    expect(reported).toMatch(/unprintable key/u);
    expect(reported).not.toMatch(/hans\.mueller@example\.test/u);
  });

  it('an operation or target kind that only a dropped CHECK could have allowed', async () => {
    // The column CHECKs block these values while they exist — verified: the insert below fails
    // with `audit_events_operation_check` until the constraints are dropped. So this rule guards
    // the case where a migration weakens or removes them, which is the same one-line change that
    // the value-kind test covers for the argument registry.
    await privileged.query('alter table audit_events disable trigger audit_events_linked_only');
    await privileged.query('alter table audit_events drop constraint audit_events_operation_check');
    await privileged.query(
      'alter table audit_events drop constraint audit_events_target_kind_check',
    );
    try {
      await privileged.query(
        `insert into audit_events(
           organisation_id, id, seq, prev_hash, hash, source, operation, target_kind,
           result, created_at, canonical_payload)
         values ($1, $2, (select coalesce(max(seq), 0) + 1 from audit_events where organisation_id = $1),
           decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'),
           'api', 'Hans Müller', 'Kundenkartei', 'succeeded', now(), 'forged')`,
        [ORG, randomUUID()],
      );
      const list = await findings();
      expect(
        list.filter((f) => f.rule === 'malformed-operation-or-target-kind').length,
      ).toBeGreaterThan(0);
      const reported = list.map((f) => `${f.subject} ${f.detail}`).join(' ');
      expect(reported).not.toMatch(/Hans Müller|Kundenkartei/u);
    } finally {
      // The append-only guard refuses this too, which is the guard doing its job.
      await privileged.query('alter table audit_events disable trigger audit_events_append_only');
      await privileged.query(`delete from audit_events where operation = 'Hans Müller'`);
      await privileged.query(
        'alter table audit_events enable always trigger audit_events_append_only',
      );
      await privileged.query(
        `alter table audit_events add constraint audit_events_operation_check
           check (operation ~ '^[a-z][a-z0-9_.-]{0,127}$')`,
      );
      await privileged.query(
        `alter table audit_events add constraint audit_events_target_kind_check
           check (target_kind ~ '^[a-z][a-z0-9_]{0,63}$')`,
      );
      await privileged.query(
        'alter table audit_events enable always trigger audit_events_linked_only',
      );
    }
  });
});

describe('the check as a process', () => {
  it('exits clean on a trail it could actually inspect, and says how much it saw', async () => {
    const clean = await createTestDatabase('audit-arguments-clean');
    const owner = createPool({ connectionString: clean.migrationUrl, max: 1 });
    try {
      const org = randomUUID();
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'clean', 'Clean')`, [
        org,
      ]);
      await withTenant(clean.pool(), org, (c) =>
        appendAuditEvent(c, {
          source: 'api',
          operation: 'test.clean',
          targetKind: 'organisation',
          result: 'succeeded',
        }),
      );
      const result = await runCheck(clean.appUrl);
      expect(result.code).toBe(0);
      // The count is the point: a clean message with no number was how the first version of this
      // check reported having inspected nothing at all.
      expect(result.out).toMatch(/1 event\(s\) across 1 tenant\(s\)/u);
    } finally {
      await owner.end();
      await clean.drop();
    }
  }, 90_000);

  it('refuses to pass when it enumerated no tenants', async () => {
    const empty = await createTestDatabase('audit-arguments-empty');
    try {
      const result = await runCheck(empty.appUrl);
      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/enumerated no tenants/u);
    } finally {
      await empty.drop();
    }
  }, 90_000);

  it('refuses to pass when tenants exist but it inspected no events', async () => {
    // This is the exact shape of the original defect: the queries returned nothing and the check
    // printed a reassuring sentence. Here the emptiness is real rather than a privilege artefact,
    // but the branch that must refuse it is the same one.
    const silent = await createTestDatabase('audit-arguments-silent');
    const owner = createPool({ connectionString: silent.migrationUrl, max: 1 });
    try {
      await owner.query(
        `insert into organisations(id, slug, name) values (gen_random_uuid(), 'silent', 'Silent')`,
      );
      const result = await runCheck(silent.appUrl);
      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/inspected 0 events/u);
    } finally {
      await owner.end();
      await silent.drop();
    }
  }, 90_000);
});
