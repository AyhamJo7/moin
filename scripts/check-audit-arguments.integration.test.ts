/**
 * The audit argument scanner, checked (P06.10.07).
 *
 * Each case writes the leak it is meant to find. Rows that the reviewed writer would reject are
 * inserted around it — with the append-only trigger disabled and as the privileged role — because
 * the scanner's purpose is precisely to find what did *not* come through the writer.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { createPool, type Pool } from '@moin/db/pool';
import { appendAuditEvent, withTenant } from '@moin/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scan, type Finding } from './check-audit-arguments.ts';

const ORG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let database: TestDatabase;
let privileged: Pool;
let app: Pool;

async function findings(): Promise<Finding[]> {
  return scan(database.migrationUrl);
}

function rulesFor(list: readonly Finding[], subject: string): string[] {
  return list
    .filter((finding) => finding.subject === subject)
    .map((finding) => finding.rule)
    .sort();
}

/** Writes an event the reviewed writer would refuse, the way a restore or repair script would. */
async function forge(operation: string, args: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify(args);
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
    expect(rulesFor(await findings(), 'test.scan.reason')).toStrictEqual([
      'non-scalar-validation-value',
    ]);
  });
});
