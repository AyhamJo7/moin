/** INV-10: real PostgreSQL checks for append-only, FORCE RLS and the audit chain. */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { appendAuditEvent, listAuditEvents, verifyAuditChain } from './audit.ts';
import { withTenant, type TenantClient } from './tenant.ts';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

interface AuditInput {
  readonly eventId?: string;
  readonly operation?: string;
  readonly versions?: Record<string, unknown>;
  readonly validation?: Record<string, unknown>;
  readonly args?: Record<string, unknown>;
}

async function append(client: TenantClient, input: AuditInput = {}): Promise<number> {
  const result = await client.query<{ seq: number }>(
    `select app.append_audit_event(
      $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::uuid,
      $7::jsonb, $8::jsonb, $9::jsonb, $10::text, $11::uuid, $12::uuid, $13::text
    )::int as seq`,
    [
      input.eventId ?? randomUUID(),
      null,
      'api',
      input.operation ?? 'test.checked',
      'organisation',
      null,
      input.versions ?? {},
      input.validation ?? {},
      input.args ?? {},
      'succeeded',
      null,
      null,
      null,
    ],
  );
  return result.rows[0]?.seq ?? -1;
}

beforeAll(async () => {
  database = await createTestDatabase('audit-events');
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  app = database.pool();
  await admin.query(
    `insert into organisations(id, slug, name) values
    ($1, 'audit-alpha', 'Audit Alpha'), ($2, 'audit-beta', 'Audit Beta')`,
    [ORG_A, ORG_B],
  );
}, 60_000);

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('the audit writer', () => {
  it('requires tenant context and rejects unapproved argument keys', async () => {
    await expect(
      app.query(
        `select app.append_audit_event(
      $1::uuid, null, 'api', 'test.checked', 'organisation', null, '{}'::jsonb,
      '{}'::jsonb, '{}'::jsonb, 'succeeded', null, null, null)`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/invalid audit event/u);
    await expect(
      withTenant(app, ORG_A, (client) =>
        append(client, {
          args: { password: 'raw-sensitive-value' },
        }),
      ),
    ).rejects.toThrow(/unapproved audit field/u);
    await expect(
      withTenant(app, ORG_A, (client) =>
        append(client, {
          validation: { email: 'raw-sensitive-value' },
        }),
      ),
    ).rejects.toThrow(/unapproved audit field/u);
    await expect(
      withTenant(app, ORG_A, (client) =>
        append(client, { validation: { caller_number: 491701234567 } }),
      ),
    ).rejects.toThrow(/unapproved audit field/u);
    const rows = await admin.query<{ n: number }>('select count(*)::int as n from audit_events');
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('allocates one sequence per tenant and leaves no direct write grant', async () => {
    expect(await withTenant(app, ORG_A, (client) => append(client))).toBe(1);
    expect(await withTenant(app, ORG_B, (client) => append(client))).toBe(1);
    await expect(
      app.query(
        `insert into audit_events(organisation_id, id, seq, prev_hash, hash,
      source, operation, target_kind, result, created_at, canonical_payload)
      values ($1, $2, 2, decode(repeat('00',32),'hex'), decode(repeat('00',32),'hex'),
      'api', 'test.checked', 'organisation', 'succeeded', now(), '{}')`,
        [ORG_A, randomUUID()],
      ),
    ).rejects.toThrow();
    await expect(app.query('truncate audit_events')).rejects.toThrow();
    const visible = await withTenant(
      app,
      ORG_A,
      async (client) =>
        (
          await client.query<{ organisation_id: string }>(
            'select organisation_id from audit_events',
          )
        ).rows,
    );
    expect(visible).toStrictEqual([{ organisation_id: ORG_A }]);
  });

  it('serialises concurrent appends and keeps the head aligned', async () => {
    const seqs = await Promise.all(
      Array.from({ length: 8 }, () => withTenant(app, ORG_A, (client) => append(client))),
    );
    expect(seqs.slice().sort((a, b) => a - b)).toStrictEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const head = await withTenant(
      app,
      ORG_A,
      async (client) =>
        (await client.query<{ last_seq: string }>('select last_seq from audit_heads')).rows[0]
          ?.last_seq,
    );
    expect(Number(head)).toBe(9);
    expect(await withTenant(app, ORG_A, verifyAuditChain)).toStrictEqual({
      valid: true,
      checked: '9',
    });
  });

  it('keeps the prior chain state when a duplicate event id fails', async () => {
    const eventId = randomUUID();
    expect(await withTenant(app, ORG_A, (client) => append(client, { eventId }))).toBe(10);
    await expect(withTenant(app, ORG_A, (client) => append(client, { eventId }))).rejects.toThrow();
    expect(await withTenant(app, ORG_A, (client) => append(client))).toBe(11);
  });

  it('blocks UPDATE and DELETE even for the table owner', async () => {
    await expect(app.query('update audit_events set result = $1', ['failed'])).rejects.toThrow();
    await expect(app.query('delete from audit_events')).rejects.toThrow();
    await expect(
      admin.query('update audit_events set result = $1 where organisation_id = $2', [
        'failed',
        ORG_A,
      ]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      admin.query('delete from audit_events where organisation_id = $1', [ORG_A]),
    ).rejects.toThrow(/append-only/u);
  });
});

describe('chain verification', () => {
  it('detects a privileged mutation and a deleted tail row', async () => {
    const isolated = await createTestDatabase('audit-tamper');
    const owner = createPool({ connectionString: isolated.migrationUrl, max: 1 });
    const runtime = isolated.pool();
    try {
      await owner.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
        ORG_A,
        'audit-tamper',
        'Audit Tamper',
      ]);
      await withTenant(runtime, ORG_A, (client) => append(client));
      expect(await withTenant(runtime, ORG_A, verifyAuditChain)).toStrictEqual({
        valid: true,
        checked: '1',
      });
      await owner.query('alter table audit_events disable trigger audit_events_append_only');
      await owner.query('update audit_events set result = $1', ['failed']);
      expect(await withTenant(runtime, ORG_A, verifyAuditChain)).toMatchObject({
        valid: false,
        reason: 'payload-mismatch',
        seq: '1',
      });
      await owner.query('delete from audit_events');
      expect(await withTenant(runtime, ORG_A, verifyAuditChain)).toMatchObject({
        valid: false,
        reason: 'missing-event',
        seq: '1',
      });
    } finally {
      await owner.end();
      await isolated.drop();
    }
  });
});

describe('audit application API', () => {
  it('does not report an empty chain as valid without tenant context', async () => {
    const unscoped: TenantClient = {
      query: () => Promise.reject(new Error('unscoped query reached the database')),
    };
    await expect(verifyAuditChain(unscoped)).rejects.toThrow(
      'audit verification requires tenant context',
    );
    await expect(listAuditEvents(unscoped)).rejects.toThrow('audit query requires tenant context');
    await expect(
      appendAuditEvent(unscoped, {
        source: 'api',
        operation: 'test.checked',
        targetKind: 'organisation',
        result: 'succeeded',
      }),
    ).rejects.toThrow('audit writer requires tenant context');
  });

  it('accepts reviewed opaque IDs but rejects raw personal data and scans stored arguments', async () => {
    await admin.query(
      `insert into audit_argument_allowlist(operation, argument_key, value_kind, reason)
       values ('test.checked', 'related_id', 'uuid', 'opaque reference only')`,
    );
    const relatedId = randomUUID();
    await withTenant(app, ORG_B, (client) =>
      appendAuditEvent(client, {
        source: 'api',
        operation: 'test.checked',
        targetKind: 'organisation',
        result: 'succeeded',
        argsSanitized: { related_id: relatedId },
      }),
    );
    await expect(
      withTenant(app, ORG_B, (client) =>
        appendAuditEvent(client, {
          source: 'api',
          operation: 'test.checked',
          targetKind: 'organisation',
          result: 'succeeded',
          argsSanitized: { related_id: 'person@example.test' },
        }),
      ),
    ).rejects.toThrow(/unapproved audit field/u);
    const scan = await admin.query<{ n: number }>(
      `select count(*)::int as n from audit_events e,
         lateral jsonb_each_text(e.args_sanitized) as arg(key, value)
       where arg.value ~* '[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}'
          or arg.value ~ '^[+][0-9][0-9 ()-]{8,}$'`,
    );
    expect(scan.rows[0]?.n).toBe(0);
  });

  it('writes within the caller transaction and queries only the scoped tenant', async () => {
    const actorId = randomUUID();
    const correlationId = randomUUID();
    const targetId = randomUUID();
    const seq = await withTenant(
      app,
      ORG_B,
      (client) =>
        appendAuditEvent(client, {
          source: 'api',
          operation: 'test.checked',
          targetKind: 'organisation',
          targetId,
          result: 'succeeded',
          validation: { approved: true },
        }),
      { actorId, correlationId },
    );
    expect(BigInt(seq)).toBeGreaterThan(0n);
    const own = await withTenant(app, ORG_B, (client) =>
      listAuditEvents(client, {
        targetKind: 'organisation',
        targetId,
        actorId,
        correlationId,
        afterSeq: (BigInt(seq) - 1n).toString(),
        limit: 1,
      }),
    );
    expect(own).toMatchObject([
      {
        seq,
        target_id: targetId,
        actor_id: actorId,
        correlation_id: correlationId,
        validation: { approved: true },
      },
    ]);
    expect(
      await withTenant(app, ORG_A, (client) => listAuditEvents(client, { targetId })),
    ).toStrictEqual([]);
    expect(
      await withTenant(app, ORG_B, (client) =>
        listAuditEvents(client, {
          targetId,
          afterSeq: seq,
        }),
      ),
    ).toStrictEqual([]);
  });

  it('rolls back a business mutation when its audit append is rejected', async () => {
    const locationId = randomUUID();
    await expect(
      withTenant(app, ORG_A, async (client) => {
        await client.query(
          'insert into locations(organisation_id, id, name, time_zone) values ($1, $2, $3, $4)',
          [ORG_A, locationId, 'Audit rollback', 'Europe/Berlin'],
        );
        await appendAuditEvent(client, {
          source: 'api',
          operation: 'location.created',
          targetKind: 'location',
          targetId: locationId,
          result: 'succeeded',
          argsSanitized: { email: 'private@example.test' },
        });
      }),
    ).rejects.toThrow(/unapproved audit field/u);
    const rows = await withTenant(app, ORG_A, (client) =>
      client.query('select id from locations where id = $1', [locationId]),
    );
    expect(rows.rows).toStrictEqual([]);
  });

  it('rejects malformed query filters without echoing the input', async () => {
    const raw = 'secret@example.test';
    await expect(
      withTenant(app, ORG_A, (client) =>
        listAuditEvents(client, {
          actorId: raw,
        }),
      ),
    ).rejects.toThrow('invalid audit query');
    await expect(
      withTenant(app, ORG_A, (client) =>
        listAuditEvents(client, {
          limit: 101,
        }),
      ),
    ).rejects.toThrow('invalid audit query');
    await expect(
      withTenant(app, ORG_A, (client) =>
        listAuditEvents(client, { afterSeq: '9999999999999999999' }),
      ),
    ).rejects.toThrow('invalid audit query');
  });
});
