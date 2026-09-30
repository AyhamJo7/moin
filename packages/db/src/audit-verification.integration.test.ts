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
  const migratorBase = new URL(process.env['TEST_DATABASE_MIGRATOR_URL'] ?? '');
  migratorBase.pathname = `/${database.name}`;
  migrator = createPool({ connectionString: migratorBase.toString(), max: 1 });
  app = database.pool();
  await organisation(ORG_A, 'verify-alpha');
  await organisation(ORG_B, 'verify-beta');
  await organisation(ORG_C, 'verify-gamma');
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
    expect(rows.rows.map((row) => row.tenant_id)).toEqual([ORG_A, ORG_B, ORG_C]);
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
    expect(next.rows.map((row) => row.id)).toEqual([ORG_C]);
    // Asking for more than exists returns what exists; the reviewed cap is asserted separately,
    // because with three tenants a missing cap and a working one look identical.
    const all = await app.query<{ id: string }>(
      'select id from app.claim_audit_chains($1::integer, $2::uuid)',
      [50, null],
    );
    expect(all.rows).toHaveLength(3);
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
  it('reports every tenant sound, including one that has never written an event', async () => {
    await event(ORG_A);
    await event(ORG_A);
    await event(ORG_B);
    const report = await verifyAuditChains(app);
    expect(report.tenants).toBe(3);
    expect(report.sound).toBe(3);
    expect(report.broken).toBe(0);
    expect(report.unchecked).toBe(0);
    expect(isSound(report)).toBe(true);
  });

  it('walks every tenant across page boundaries', async () => {
    // One tenant per page: the paging loop, not the page size, must decide when the sweep ends.
    const report = await verifyAuditChains(app, { pageSize: 1 });
    expect(report.tenants).toBe(3);
    expect(report.sound).toBe(3);
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
    expect(report.sound).toBe(2);
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
    await privileged.query('delete from audit_heads where organisation_id = $1', [ORG_B]);
    const report = await verifyAuditChains(app);
    const forB = report.breaks.find((found) => found.organisationId === ORG_B);
    expect(forB?.reason).toBe('missing-head');
    expect(report.tenants).toBe(3);
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
