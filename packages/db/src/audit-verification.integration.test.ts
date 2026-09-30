/**
 * P06.10.05 / INV-10: the daily chain verifier against real PostgreSQL.
 *
 * Every property here depends on database behaviour — FORCE RLS applying to the table owner, a
 * trigger rejecting a privileged DELETE, a SECURITY DEFINER function reading a global register.
 * None of it can be established against a substitute, and an embedded Postgres runs as superuser,
 * which would silently bypass the policies these tests exist to prove.
 */
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { appendAuditEvent } from './audit.ts';
import { isSound, verifyAuditChains, type AuditChainBreak } from './audit-verification.ts';
import { withTenant } from './tenant.ts';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORG_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** The cap inside `app.claim_audit_chains`. A caller cannot get a larger page than this. */
const MAX_CLAIM_PAGE = 1000;

let database: TestDatabase;
let app: Pool;
/** Locally the owner is the bootstrap superuser, so this stands in for a privileged attacker. */
let privileged: Pool;
/** The role that owns the tables: FORCE RLS still applies to it. */
let migrator: Pool;

async function organisation(id: string, slug: string): Promise<void> {
  await privileged.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
    id,
    slug,
    slug,
  ]);
}

async function event(organisationId: string): Promise<void> {
  await withTenant(app, organisationId, (client) =>
    appendAuditEvent(client, {
      source: 'api',
      operation: 'test.checked',
      targetKind: 'organisation',
      result: 'succeeded',
    }),
  );
}

beforeAll(async () => {
  database = await createTestDatabase('audit-verification');
  privileged = createPool({ connectionString: database.migrationUrl, max: 2 });
  const migratorEnv = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (migratorEnv === undefined || migratorEnv.length === 0) {
    // Naming the variable rather than letting `new URL('')` throw `Invalid URL`, which is the
    // lesson `packages/testing/src/pg/template.ts` already paid for once.
    throw new Error(
      'TEST_DATABASE_MIGRATOR_URL is not set. These tests need the non-superuser owner connection ' +
        'on purpose: the admin connection bypasses row-level security, which is exactly the trap ' +
        'the assertions below exist to prove.',
    );
  }
  const migratorBase = new URL(migratorEnv);
  migratorBase.pathname = `/${database.name}`;
  migrator = createPool({ connectionString: migratorBase.toString(), max: 1 });
  app = database.pool();
  await organisation(ORG_A, 'verify-alpha');
  await organisation(ORG_B, 'verify-beta');
  await organisation(ORG_C, 'verify-gamma');
  await organisation(ORG_D, 'verify-delta');
}, 60_000);

afterAll(async () => {
  await privileged.end();
  await migrator.end();
  await database.drop();
});

describe('the tenant register', () => {
  it('is filled by the trigger, not by the caller remembering', async () => {
    const rows = await privileged.query<{ tenant_id: string }>(
      'select tenant_id from audit_chain_registry order by tenant_id',
    );
    expect(rows.rows.map((row) => row.tenant_id)).toEqual([ORG_A, ORG_B, ORG_C, ORG_D]);
  });

  it('cannot be enumerated unelevated — not even by the role that owns organisations', async () => {
    // This is the measured fact the whole design rests on: with no tenant context, FORCE RLS hides
    // every organisation from its own owner, so no role may enumerate tenants directly.
    const asMigrator = await migrator.query<{ n: string }>(
      'select count(*) as n from organisations',
    );
    expect(asMigrator.rows[0]?.n).toBe('0');
    const asApp = await app.query<{ n: string }>('select count(*) as n from organisations');
    expect(asApp.rows[0]?.n).toBe('0');
    // And the register itself is not readable by the runtime role at all.
    await expect(app.query('select * from audit_chain_registry')).rejects.toThrow(
      /permission denied/u,
    );
  });

  it('rejects a privileged DELETE and UPDATE, so a chain cannot be hidden by dropping its row', async () => {
    await expect(
      privileged.query('delete from audit_chain_registry where tenant_id = $1', [ORG_A]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      privileged.query('update audit_chain_registry set tenant_id = $1 where tenant_id = $1', [
        ORG_A,
      ]),
    ).rejects.toThrow(/append-only/u);
  });

  it('hands the runtime role identifiers only, capped and key-paged', async () => {
    const page = await app.query<{ organisation_id: string; id: string }>(
      'select organisation_id, id from app.claim_audit_chains($1::integer, $2::uuid)',
      [2, null],
    );
    expect(page.rows.map((row) => row.organisation_id)).toEqual([ORG_A, ORG_B]);
    expect(Object.keys(page.rows[0] ?? {})).toEqual(['organisation_id', 'id']);
    const next = await app.query<{ id: string }>(
      'select id from app.claim_audit_chains($1::integer, $2::uuid)',
      [2, ORG_B],
    );
    expect(next.rows.map((row) => row.id)).toEqual([ORG_C, ORG_D]);
    // Asking for more than exists returns what exists; the reviewed cap is asserted separately,
    // because with three tenants a missing cap and a working one look identical.
    const all = await app.query<{ id: string }>(
      'select id from app.claim_audit_chains($1::integer, $2::uuid)',
      [50, null],
    );
    expect(all.rows).toHaveLength(4);
  });

  it('caps a page at the reviewed maximum however much the caller asks for', async () => {
    // Its own database: proving the cap needs more tenants than the rest of this file assumes, and
    // a fixture that changes another test's tenant count is how a suite starts passing in one order
    // only.
    const bulk = await createTestDatabase('audit-chain-cap');
    const owner = createPool({ connectionString: bulk.migrationUrl, max: 1 });
    const bulkApp = bulk.pool();
    try {
      await owner.query(
        `insert into organisations(id, slug, name)
         select gen_random_uuid(), 'bulk-' || g, 'Bulk ' || g from generate_series(1, $1::int) g`,
        [MAX_CLAIM_PAGE + 1],
      );
      const registered = await owner.query<{ n: string }>(
        'select count(*) as n from audit_chain_registry',
      );
      expect(Number(registered.rows[0]?.n)).toBe(MAX_CLAIM_PAGE + 1);

      const greedy = await bulkApp.query<{ id: string }>(
        'select id from app.claim_audit_chains($1::integer, $2::uuid)',
        [MAX_CLAIM_PAGE * 10, null],
      );
      expect(greedy.rows).toHaveLength(MAX_CLAIM_PAGE);

      // A negative or null limit yields nothing rather than everything.
      for (const limit of [-1, 0, null]) {
        const none = await bulkApp.query(
          'select id from app.claim_audit_chains($1::integer, $2::uuid)',
          [limit, null],
        );
        expect(none.rows).toHaveLength(0);
      }
    } finally {
      await owner.end();
      await bulk.drop();
    }
  }, 60_000);
});

describe('the daily sweep', () => {
  it('reports every tenant sound, including ones that have never written an event', async () => {
    await event(ORG_A);
    await event(ORG_A);
    await event(ORG_B);
    const report = await verifyAuditChains(app);
    expect(report.tenants).toBe(4);
    expect(report.sound).toBe(4);
    expect(report.broken).toBe(0);
    expect(report.unchecked).toBe(0);
    expect(report.unregistered).toBe(0);
    expect(isSound(report)).toBe(true);
  });

  it('walks every tenant across page boundaries', async () => {
    // One tenant per page: the paging loop, not the page size, must decide when the sweep ends.
    const report = await verifyAuditChains(app, { pageSize: 1 });
    expect(report.tenants).toBe(4);
    expect(report.sound).toBe(4);
    expect(isSound(report)).toBe(true);
  });

  it('rejects a page size outside the reviewed bounds instead of silently clamping', async () => {
    await expect(verifyAuditChains(app, { pageSize: 0 })).rejects.toThrow(/page size/u);
    await expect(verifyAuditChains(app, { pageSize: 1001 })).rejects.toThrow(/page size/u);
  });
});

describe('what the sweep finds', () => {
  it('names the tenant and the sequence when a committed event is changed privilegedly', async () => {
    // The append-only trigger blocks UPDATE, so a tamper has to disable it first — which is exactly
    // the privileged actor ADR-0017 names as inside the trust boundary.
    await privileged.query('alter table audit_events disable trigger audit_events_append_only');
    try {
      await privileged.query(
        `update audit_events set result = 'failed' where organisation_id = $1 and seq = 1`,
        [ORG_A],
      );
    } finally {
      await privileged.query('alter table audit_events enable trigger audit_events_append_only');
    }

    const alarmed: AuditChainBreak[] = [];
    const report = await verifyAuditChains(app, { onBreak: (found) => alarmed.push(found) });

    expect(report.broken).toBe(1);
    expect(report.sound).toBe(3);
    expect(isSound(report)).toBe(false);
    expect(alarmed).toHaveLength(1);
    expect(alarmed[0]?.organisationId).toBe(ORG_A);
    expect(alarmed[0]?.reason).toBe('payload-mismatch');
    expect(alarmed[0]?.seq).toBe('1');
    // The alarm fires as the break is found, not only in the returned report.
    expect(report.breaks[0]).toEqual(alarmed[0]);

    // Restore, so the remaining tests start from a sound chain.
    await privileged.query('alter table audit_events disable trigger audit_events_append_only');
    try {
      await privileged.query(
        `update audit_events set result = 'succeeded' where organisation_id = $1 and seq = 1`,
        [ORG_A],
      );
    } finally {
      await privileged.query('alter table audit_events enable trigger audit_events_append_only');
    }
    expect(isSound(await verifyAuditChains(app))).toBe(true);
  });

  it('finds a removed tail event rather than trusting the head', async () => {
    await privileged.query('alter table audit_events disable trigger audit_events_append_only');
    try {
      await privileged.query('delete from audit_events where organisation_id = $1 and seq = 2', [
        ORG_A,
      ]);
    } finally {
      await privileged.query('alter table audit_events enable trigger audit_events_append_only');
    }

    const report = await verifyAuditChains(app);
    expect(report.broken).toBe(1);
    expect(report.breaks[0]?.organisationId).toBe(ORG_A);
    expect(report.breaks[0]?.reason).toBe('missing-event');
  });

  it('still covers a tenant whose chain head was deleted, because it walks the register', async () => {
    // The point of enumerating the register rather than `audit_heads`: deleting the head must not
    // remove the tenant from the worklist, or "delete the head" would hide a whole chain.
    // Deleting a head is now refused outright, which is the guard working. A restore with triggers
    // disabled is the path that still gets there, so that is what this reproduces.
    await expect(
      privileged.query('delete from audit_heads where organisation_id = $1', [ORG_B]),
    ).rejects.toThrow(/cannot be deleted/u);
    await privileged.query('alter table audit_heads disable trigger audit_heads_advance_only');
    try {
      await privileged.query('delete from audit_heads where organisation_id = $1', [ORG_B]);
    } finally {
      await privileged.query(
        'alter table audit_heads enable always trigger audit_heads_advance_only',
      );
    }
    const report = await verifyAuditChains(app);
    const forB = report.breaks.find((found) => found.organisationId === ORG_B);
    expect(forB?.reason).toBe('missing-head');
    expect(report.tenants).toBe(4);
  });

  it('detects a head rolled back to zero, which leaves every event in place', async () => {
    // The verifier walks `seq <= last_seq` and then compares its running hash with `last_hash`, so
    // an unconstrained head is the cheapest way to defeat the whole scheme: measured before the
    // guard existed, this returned `valid: true, checked: 0` for a tenant with a full trail.
    await event(ORG_C);
    await event(ORG_C);
    await expect(
      privileged.query(
        `update audit_heads set last_seq = 0, last_hash = decode(repeat('00', 32), 'hex')
         where organisation_id = $1`,
        [ORG_C],
      ),
    ).rejects.toThrow(/advance by one/u);

    await privileged.query('alter table audit_heads disable trigger audit_heads_advance_only');
    try {
      await privileged.query(
        `update audit_heads set last_seq = 0, last_hash = decode(repeat('00', 32), 'hex')
         where organisation_id = $1`,
        [ORG_C],
      );
    } finally {
      await privileged.query(
        'alter table audit_heads enable always trigger audit_heads_advance_only',
      );
    }

    const report = await verifyAuditChains(app);
    const forC = report.breaks.find((found) => found.organisationId === ORG_C);
    expect(forC?.reason).toBe('event-past-head');
    expect(isSound(report)).toBe(false);
  });

  it('detects a forged event written past the head', async () => {
    // An INSERT is not an UPDATE or a DELETE, so the append-only trigger never saw it; the walk
    // stops at the head and never reads the forged row, while the query API serves it as genuine.
    await event(ORG_D);
    await expect(
      privileged.query(
        `insert into audit_events(organisation_id, id, seq, prev_hash, hash, source, operation,
           target_kind, result, created_at, canonical_payload)
         values ($1, gen_random_uuid(), 999999, decode(repeat('ee', 32), 'hex'),
           decode(repeat('ff', 32), 'hex'), 'api', 'forged.event', 'organisation', 'succeeded',
           now(), 'forged')`,
        [ORG_D],
      ),
    ).rejects.toThrow(/not correctly linked/u);

    await privileged.query('alter table audit_events disable trigger audit_events_linked_only');
    try {
      await privileged.query(
        `insert into audit_events(organisation_id, id, seq, prev_hash, hash, source, operation,
           target_kind, result, created_at, canonical_payload)
         values ($1, gen_random_uuid(), 999999, decode(repeat('ee', 32), 'hex'),
           decode(repeat('ff', 32), 'hex'), 'api', 'forged.event', 'organisation', 'succeeded',
           now(), 'forged')`,
        [ORG_D],
      );
    } finally {
      await privileged.query(
        'alter table audit_events enable always trigger audit_events_linked_only',
      );
    }

    const report = await verifyAuditChains(app);
    const forD = report.breaks.find((found) => found.organisationId === ORG_D);
    expect(forD?.reason).toBe('event-past-head');
  });

  it('refuses TRUNCATE on the register, the events and the heads', async () => {
    // A row-level trigger does not see TRUNCATE, and TRUNCATE is a third row-removing verb. On the
    // register it is the whole estate leaving the worklist at once.
    for (const table of ['audit_chain_registry', 'audit_events', 'audit_heads']) {
      // eslint-disable-next-line no-restricted-syntax -- a fixed table name from this literal array, never caller input.
      await expect(privileged.query(`truncate ${table} cascade`)).rejects.toThrow(/append-only/u);
    }
  });

  it('reports a provisioned tenant that never reached the register', async () => {
    // The register would otherwise be its own witness: disabling the registration trigger around
    // one insert leaves nothing in the catalog to find afterwards.
    const hidden = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await privileged.query(
      'alter table organisations disable trigger organisations_register_audit_chain',
    );
    try {
      await privileged.query(
        `insert into organisations(id, slug, name) values ($1, 'verify-hidden', 'Hidden')`,
        [hidden],
      );
    } finally {
      await privileged.query(
        'alter table organisations enable always trigger organisations_register_audit_chain',
      );
    }
    // The provisioning audit trigger wants tenant context it has no reason to have here: this test
    // is about the register row being absent, not about the audit append.
    await privileged.query(
      'alter table provisioning_requests disable trigger provisioning_request_audit',
    );
    try {
      await privileged.query(
        'insert into provisioning_requests(request_id, tenant_id) values (gen_random_uuid(), $1)',
        [hidden],
      );
    } finally {
      await privileged.query(
        'alter table provisioning_requests enable trigger provisioning_request_audit',
      );
    }

    const seen: string[] = [];
    const report = await verifyAuditChains(app, { onUnregistered: (id) => seen.push(id) });
    expect(report.unregistered).toBe(1);
    expect(report.unregisteredTenants).toContain(hidden);
    expect(seen).toContain(hidden);
    // The decisive part: a chain nobody can even enumerate must not read as a clean estate.
    expect(isSound(report)).toBe(false);
  });

  it('counts a tenant it could not check as unchecked, never as sound', async () => {
    // A revoked EXECUTE on the canonical-payload helper makes verification fail for every tenant
    // that has events, without making any chain unsound.
    await privileged.query(
      `revoke execute on function app.audit_canonical_payload(
         uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid,
         text, timestamptz) from moin_app`,
    );
    try {
      const failures: string[] = [];
      const report = await verifyAuditChains(app, {
        onFailure: (failure) => failures.push(failure.organisationId),
      });
      expect(report.unchecked).toBeGreaterThan(0);
      expect(report.sound + report.broken + report.unchecked).toBe(report.tenants);
      expect(isSound(report)).toBe(false);
      expect(failures.length).toBe(report.unchecked);
    } finally {
      await privileged.query(
        `grant execute on function app.audit_canonical_payload(
           uuid, bigint, uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid,
           text, timestamptz) to moin_app`,
      );
    }
  });

  it('refuses to report a clean run when the register cannot be read at all', async () => {
    await privileged.query(
      'revoke execute on function app.claim_audit_chains(integer, uuid) from moin_app',
    );
    try {
      // Rejecting is the whole point: a sweep that enumerated nothing has verified nothing, and
      // returning an empty, sound-looking report would be the worst possible answer.
      await expect(verifyAuditChains(app)).rejects.toThrow(/permission denied/u);
    } finally {
      await privileged.query(
        'grant execute on function app.claim_audit_chains(integer, uuid) to moin_app',
      );
    }
  });
});
