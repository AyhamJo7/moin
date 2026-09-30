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

/** Forges a row into any database, with the link guard disabled the way a restore would. */
async function forgeInto(
  owner: Pool,
  org: string,
  operation: string,
  payload: string,
): Promise<void> {
  await owner.query('alter table audit_events disable trigger audit_events_linked_only');
  try {
    await owner.query(
      `insert into audit_events(
         organisation_id, id, seq, prev_hash, hash, source, operation, target_kind,
         result, args_sanitized, created_at, canonical_payload)
       values ($1, $2, (select coalesce(max(seq), 0) + 1 from audit_events where organisation_id = $1),
         decode(repeat('00', 32), 'hex'), decode(repeat('11', 32), 'hex'),
         'api', $3, 'organisation', 'succeeded', $4::jsonb, now(), 'forged')`,
      [org, randomUUID(), operation, payload],
    );
  } finally {
    await owner.query('alter table audit_events enable always trigger audit_events_linked_only');
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

describe('values are validated against their registered kind', () => {
  // Being registered used to be treated as sufficient: the kind was read and then only strings
  // were ever tested, for UUID shape. Measured before the fix: `related_id: true` under a `uuid`
  // kind produced **no finding at all**, and a `boolean` kind holding a UUID string passed because
  // the string happened to look like a UUID.
  const cases: readonly {
    readonly label: string;
    readonly args: Record<string, unknown>;
    readonly rule: string;
    readonly subject: string;
  }[] = [
    {
      label: 'a uuid kind holding a boolean',
      args: { related_id: true },
      rule: 'argument-kind-mismatch',
      subject: 'test.scan.related_id',
    },
    {
      label: 'a uuid kind holding a number',
      args: { related_id: 7 },
      rule: 'argument-kind-mismatch',
      subject: 'test.scan.related_id',
    },
    {
      label: 'a boolean kind holding a uuid string',
      args: { was_confirmed: '11111111-1111-4111-8111-111111111111' },
      rule: 'argument-kind-mismatch',
      subject: 'test.scan.was_confirmed',
    },
    {
      label: 'a count kind holding a boolean',
      args: { item_count: true },
      rule: 'argument-kind-mismatch',
      subject: 'test.scan.item_count',
    },
    {
      label: 'a count kind holding a string',
      args: { item_count: '3' },
      rule: 'argument-kind-mismatch',
      subject: 'test.scan.item_count',
    },
    {
      label: 'a count kind holding a negative number',
      args: { item_count: -5 },
      rule: 'argument-value-out-of-range',
      subject: 'test.scan.item_count',
    },
    {
      label: 'a count kind holding a fractional number',
      args: { item_count: 1.5 },
      rule: 'argument-value-out-of-range',
      subject: 'test.scan.item_count',
    },
    {
      label: 'a count kind above its reviewed bound',
      args: { item_count: 1_000_000_000 },
      rule: 'argument-value-out-of-range',
      subject: 'test.scan.item_count',
    },
  ];

  for (const testCase of cases) {
    it(`catches ${testCase.label}`, async () => {
      const isolated = await createTestDatabase('audit-arguments-kind');
      const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
      try {
        await owner.query(`insert into organisations(id, slug, name) values ($1, 'kind', 'Kind')`, [
          ORG,
        ]);
        await owner.query(
          `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
           values ('test.scan', 'related_id', 'uuid', 'opaque'),
                  ('test.scan', 'was_confirmed', 'boolean', 'flag'),
                  ('test.scan', 'item_count', 'count', 'bounded')`,
        );
        await forgeInto(owner, ORG, 'test.scan', JSON.stringify(testCase.args));

        const result = await scan(isolated.appUrl);
        expect(result.events).toBeGreaterThan(0);
        expect(rulesFor([...result.findings], testCase.subject)).toContain(testCase.rule);
        // The value is never printed, whatever its type.
        const reported = result.findings.map((f) => `${f.subject} ${f.detail}`).join(' ');
        for (const value of Object.values(testCase.args)) {
          expect(reported).not.toContain(String(value));
        }
      } finally {
        await owner.end();
        await isolated.drop();
      }
    }, 90_000);
  }

  it('fails closed on a registered kind it has no validator for', async () => {
    // The `CHECK` has to be dropped first, which is the point: widening the kinds is a one-line
    // migration, and a kind nobody wrote a validator for cannot be said to have been checked.
    const isolated = await createTestDatabase('audit-arguments-unknown-kind');
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    try {
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'unk', 'Unk')`, [
        ORG,
      ]);
      await owner.query(
        `alter table audit_argument_allowlist drop constraint audit_argument_allowlist_value_kind_check`,
      );
      await owner.query(
        `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
         values ('test.scan', 'note', 'text', 'free text, which is the thing we do not allow')`,
      );
      await forgeInto(owner, ORG, 'test.scan', JSON.stringify({ note: 'anything at all' }));

      const result = await scan(isolated.appUrl);
      const rules = rulesFor([...result.findings], 'test.scan.note');
      expect(rules).toContain('unvalidatable-argument-kind');
      // And the registry row itself is still reported.
      expect(result.findings.some((f) => f.rule === 'unreviewed-value-kind')).toBe(true);
    } finally {
      await owner.end();
      await isolated.drop();
    }
  }, 90_000);

  it('accepts every registered kind when the stored value actually conforms', async () => {
    // The other half of the property: a validator that rejects valid values is noise.
    const isolated = await createTestDatabase('audit-arguments-conforming');
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    try {
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'ok', 'OK')`, [ORG]);
      await owner.query(
        `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
         values ('test.scan', 'related_id', 'uuid', 'opaque'),
                ('test.scan', 'was_confirmed', 'boolean', 'flag'),
                ('test.scan', 'item_count', 'count', 'bounded')`,
      );
      await withTenant(isolated.pool(), ORG, (c) =>
        appendAuditEvent(c, {
          source: 'api',
          operation: 'test.scan',
          targetKind: 'organisation',
          result: 'succeeded',
          argsSanitized: {
            related_id: randomUUID(),
            was_confirmed: false,
            item_count: 0,
          },
        }),
      );
      const result = await scan(isolated.appUrl);
      expect(result.findings).toStrictEqual([]);
      expect(result.unregistered).toBe(0);
    } finally {
      await owner.end();
      await isolated.drop();
    }
  }, 90_000);
});

describe('scanner coverage is reconciled, not assumed', () => {
  /** One registered tenant with a valid event, and one provisioned tenant with no register row. */
  async function withHiddenTenant(
    label: string,
    hiddenArgs: Record<string, unknown> | undefined,
  ): Promise<{ db: TestDatabase; hidden: string }> {
    const isolated = await createTestDatabase(label);
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    const hidden = '5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d';
    try {
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'seen', 'Seen')`, [
        ORG,
      ]);
      await owner.query(
        `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
         values ('test.scan', 'related_id', 'uuid', 'opaque')`,
      );
      await withTenant(isolated.pool(), ORG, (c) =>
        appendAuditEvent(c, {
          source: 'api',
          operation: 'test.scan',
          targetKind: 'organisation',
          result: 'succeeded',
          argsSanitized: { related_id: randomUUID() },
        }),
      );

      // The tenant the register never learned about.
      await owner.query(
        'alter table organisations disable trigger organisations_register_audit_chain',
      );
      try {
        await owner.query(
          `insert into organisations(id, slug, name) values ($1, 'hidden', 'Hidden')`,
          [hidden],
        );
      } finally {
        await owner.query(
          'alter table organisations enable always trigger organisations_register_audit_chain',
        );
      }
      await owner.query(
        'alter table provisioning_requests disable trigger provisioning_request_audit',
      );
      try {
        await owner.query(
          'insert into provisioning_requests(request_id, tenant_id) values (gen_random_uuid(), $1)',
          [hidden],
        );
      } finally {
        await owner.query(
          'alter table provisioning_requests enable trigger provisioning_request_audit',
        );
      }
      if (hiddenArgs !== undefined) {
        await forgeInto(owner, hidden, 'test.scan', JSON.stringify(hiddenArgs));
      }
    } finally {
      await owner.end();
    }
    return { db: isolated, hidden };
  }

  it('fails when a provisioned tenant hides a leaking argument outside the register', async () => {
    // The exact fail-open shape: the scanner walked the register, found tenant A clean, and never
    // learned that tenant B existed at all — so the planted leak went unreported and it exited 0.
    const { db: isolated, hidden } = await withHiddenTenant('audit-arguments-hidden-leak', {
      related_id: 'Gurlitt Sanitär GmbH',
    });
    try {
      const result = await scan(isolated.appUrl);
      expect(result.unregistered).toBe(1);
      expect(rulesFor([...result.findings], hidden)).toContain('unregistered-tenant-not-scanned');

      const run = await runCheck(isolated.appUrl);
      expect(run.code).not.toBe(0);
      expect(run.out).toMatch(/could not reach 1 provisioned tenant/u);
      // Names the coverage gap without leaking what is inside it.
      expect(run.out).not.toMatch(/Gurlitt|Sanitär/u);
    } finally {
      await isolated.drop();
    }
  }, 120_000);

  it('fails on an unregistered tenant even when its arguments are perfectly valid', async () => {
    // Coverage is the property, not cleanliness of what happened to be visible.
    const { db: isolated, hidden } = await withHiddenTenant('audit-arguments-hidden-clean', {
      related_id: '22222222-2222-4222-8222-222222222222',
    });
    try {
      const result = await scan(isolated.appUrl);
      expect(result.unregistered).toBe(1);
      expect(rulesFor([...result.findings], hidden)).toStrictEqual([
        'unregistered-tenant-not-scanned',
      ]);
      const run = await runCheck(isolated.appUrl);
      expect(run.code).not.toBe(0);
    } finally {
      await isolated.drop();
    }
  }, 120_000);

  it('still fails on a provisioned tenant absent from the register, which traversal cannot see', async () => {
    // The two checks are independent and neither subsumes the other: the population snapshot
    // bounds what traversal covers, and traversal covers only what the register knows.
    const { db: isolated, hidden } = await withHiddenTenant('audit-arguments-both-checks', {
      related_id: 'Outside The Register',
    });
    try {
      const result = await scan(isolated.appUrl);
      // Traversal itself is clean over the captured population.
      expect(
        result.findings.filter((f) => f.rule !== 'unregistered-tenant-not-scanned'),
      ).toStrictEqual([]);
      // And the witness still fails the run.
      expect(result.unregistered).toBe(1);
      expect(rulesFor([...result.findings], hidden)).toStrictEqual([
        'unregistered-tenant-not-scanned',
      ]);
      const run = await runCheck(isolated.appUrl);
      expect(run.code).not.toBe(0);
      expect(run.out).not.toMatch(/Outside The Register/u);
    } finally {
      await isolated.drop();
    }
  }, 180_000);
  it('succeeds once every provisioned tenant is registered', async () => {
    const { db: isolated, hidden } = await withHiddenTenant('audit-arguments-hidden-fixed', {
      related_id: '33333333-3333-4333-8333-333333333333',
    });
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    try {
      await owner.query('insert into audit_chain_registry(tenant_id) values ($1)', [hidden]);
      const result = await scan(isolated.appUrl);
      expect(result.unregistered).toBe(0);
      expect(result.findings).toStrictEqual([]);
      const run = await runCheck(isolated.appUrl);
      expect(run.code).toBe(0);
      expect(run.out).toMatch(/every provisioned tenant registered/u);
    } finally {
      await owner.end();
      await isolated.drop();
    }
  }, 120_000);
});

describe('CASE 5 — the scanner uses the same population snapshot', () => {
  /**
   * The reported reproduction: a full page, then a late registration whose UUID sorts lexically
   * behind the cursor. Under UUID paging the next page came back empty and the run reported clean
   * having skipped it. The page size here is the scanner's real `TENANT_PAGE_SIZE` of 200, so the
   * first page is full and a second is genuinely requested.
   */
  it('a late registration behind the cursor is excluded by the bound, not skipped by ordering', async () => {
    const isolated = await createTestDatabase('audit-arguments-population');
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    try {
      await owner.query(
        `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
         values ('test.scan', 'related_id', 'uuid', 'opaque')`,
      );
      // 200 tenants, all sorting after the late one below, so the cursor ends up lexically ahead.
      await owner.query(
        `insert into organisations(id, slug, name)
         select ('f' || lpad(to_hex(g), 7, '0') || '-ffff-4fff-8fff-ffffffffffff')::uuid,
                'bulk-' || g, 'Bulk ' || g
         from generate_series(1, 200) g`,
      );
      const marked = await owner.query<{ n: string }>(
        'select coalesce(max(registration_seq), 0)::text as n from audit_chain_registry',
      );
      expect(Number(marked.rows[0]?.n)).toBe(200);

      // Every tenant gets one valid event so the scan has something to inspect.
      const appPool = isolated.pool();
      const ids = await owner.query<{ id: string }>(
        'select id::text from organisations order by id',
      );
      for (const row of ids.rows) {
        await withTenant(appPool, row.id, (c) =>
          appendAuditEvent(c, {
            source: 'api',
            operation: 'test.scan',
            targetKind: 'organisation',
            result: 'succeeded',
            argsSanitized: { related_id: randomUUID() },
          }),
        );
      }

      const before = await scan(isolated.appUrl);
      expect(before.populationHighWater).toBe('200');
      expect(before.tenants).toBe(200);
      expect(before.findings).toStrictEqual([]);

      // The late one: registered last, sorts first, and carries a leak.
      const late = '00000000-0000-4000-8000-000000000001';
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'late', 'Late')`, [
        late,
      ]);
      await forgeInto(owner, late, 'test.scan', JSON.stringify({ related_id: 'Gurlitt GmbH' }));

      // Its sequence is above the previous mark, which is what makes it the *next* run's business
      // rather than something the previous run should have caught.
      const lateSeq = await owner.query<{ n: string }>(
        'select registration_seq::text as n from audit_chain_registry where tenant_id = $1',
        [late],
      );
      expect(Number(lateSeq.rows[0]?.n)).toBe(201);

      // A fresh run captures a new mark, so it scans 201 tenants and finds the leak. Under UUID
      // paging the leak-bearing tenant sat behind the cursor and was reported clean.
      const after = await scan(isolated.appUrl);
      expect(after.populationHighWater).toBe('201');
      expect(after.tenants).toBe(201);
      expect(after.findings.some((f) => f.rule === 'free-text-argument')).toBe(true);
    } finally {
      await owner.end();
      await isolated.drop();
    }
  }, 240_000);

  it('does not adopt a registration that lands while it is running', async () => {
    // The scanner's own page boundary. Two members in the captured population, page size is the
    // production 200 so one page drains it; a tenant registered after the mark is read must not
    // make this run fail, and must be picked up by the next one.
    const isolated = await createTestDatabase('audit-arguments-midrun');
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    try {
      await owner.query(
        `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
         values ('test.scan', 'related_id', 'uuid', 'opaque')`,
      );
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'mid-one', 'One')`, [
        ORG,
      ]);
      await withTenant(isolated.pool(), ORG, (c) =>
        appendAuditEvent(c, {
          source: 'api',
          operation: 'test.scan',
          targetKind: 'organisation',
          result: 'succeeded',
          argsSanitized: { related_id: randomUUID() },
        }),
      );

      const first = await scan(isolated.appUrl);
      expect(first.populationHighWater).toBe('1');
      expect(first.tenants).toBe(1);
      expect(first.findings).toStrictEqual([]);

      // Sorts behind the first tenant's UUID, registered after it.
      const behind = '00000000-0000-4000-8000-000000000002';
      await owner.query(`insert into organisations(id, slug, name) values ($1, 'mid-two', 'Two')`, [
        behind,
      ]);
      await forgeInto(owner, behind, 'test.scan', JSON.stringify({ related_id: 'Behind Cursor' }));

      const second = await scan(isolated.appUrl);
      expect(second.populationHighWater).toBe('2');
      expect(second.tenants).toBe(2);
      expect(second.findings.some((f) => f.rule === 'free-text-argument')).toBe(true);
      // Coverage traversal and the provisioning witness are separate: this tenant *is* registered,
      // so the witness is silent and only traversal could have caught it.
      expect(second.unregistered).toBe(0);
    } finally {
      await owner.end();
      await isolated.drop();
    }
  }, 180_000);
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
