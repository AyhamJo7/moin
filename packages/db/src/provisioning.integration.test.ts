/** P06.04: exercise the only tenant-creation boundary as its real restricted role. */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { createPool, type Pool } from './pool.ts';
import { verifyAuditChain } from './audit.ts';
import { withTenant } from './tenant.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let database: TestDatabase;
let provisioner: Pool;
let admin: Pool;

interface ProvisionInput {
  readonly requestId?: string;
  readonly slug?: string;
  readonly name?: string;
  readonly location?: string;
  readonly email?: string;
  readonly template?: string;
  readonly plan?: string;
  readonly earlyAccess?: boolean;
  readonly timeZone?: string;
}

async function provision(input: ProvisionInput = {}): Promise<string> {
  const result = await provisioner.query<{ provision_tenant: string }>(
    'select app.provision_tenant($1::uuid, $2::citext, $3::text, $4::text, $5::text, $6::text, $7::text, $8::boolean, $9::text)',
    [
      input.requestId ?? randomUUID(),
      input.slug ?? `tenant-${randomUUID().slice(0, 12)}`,
      input.name ?? 'Test Betrieb',
      input.location ?? 'Hamburg',
      input.email ?? 'owner@example.test',
      input.template ?? 'restaurant@1.0',
      input.plan ?? 'pilot',
      input.earlyAccess ?? false,
      input.timeZone ?? 'Europe/Berlin',
    ],
  );
  const id = result.rows[0]?.provision_tenant;
  if (id === undefined) throw new Error('provisioning returned no id');
  return id;
}

function provisionerUrl(): string {
  const base = process.env['TEST_DATABASE_PROVISIONER_URL'];
  if (base === undefined) throw new Error('TEST_DATABASE_PROVISIONER_URL is required');
  const url = new URL(base);
  url.pathname = `/${database.name}`;
  return url.toString();
}

async function count(
  table:
    | 'organisations'
    | 'locations'
    | 'tenant_setup'
    | 'owner_invitation_requests'
    | 'provisioning_requests'
    | 'audit_events'
    | 'audit_heads',
): Promise<number> {
  // Identifiers are selected only from the literal union above, never from untrusted input.
  // eslint-disable-next-line no-restricted-syntax -- test fixture table identifier from a closed union.
  const result = await admin.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return result.rows[0]?.n ?? -1;
}

beforeEach(async () => {
  database = await createTestDatabase('provisioning');
  provisioner = createPool({ connectionString: provisionerUrl(), max: 4 });
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
});

afterEach(async () => {
  await provisioner.end();
  await admin.end();
  await database.drop();
});

describe('provisioning authority and consistency', () => {
  it('creates exactly one complete, tenant-scoped setup', async () => {
    const functionOwner = await admin.query<{
      owner: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      `select pg_get_userbyid(p.proowner)::text as owner, r.rolbypassrls, r.rolsuper
       from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.oid = 'app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)'::regprocedure`,
    );
    expect(functionOwner.rows[0]).toStrictEqual({
      owner: 'moin_migrator',
      rolbypassrls: false,
      rolsuper: false,
    });
    const id = await provision();
    expect(await count('organisations')).toBe(1);
    expect(await count('locations')).toBe(1);
    expect(await count('tenant_setup')).toBe(1);
    expect(await count('owner_invitation_requests')).toBe(1);
    expect(await count('provisioning_requests')).toBe(1);
    const app = database.pool();
    const audit = await withTenant(app, id, async (client) => {
      const events = await client.query<{ operation: string; correlation_id: string }>(
        'select operation, correlation_id from audit_events',
      );
      return { events: events.rows, chain: await verifyAuditChain(client) };
    });
    expect(audit.events).toMatchObject([{ operation: 'tenant.provisioned' }]);
    expect(audit.chain).toStrictEqual({ valid: true, checked: '1' });
    expect(
      (await app.query<{ n: number }>('select count(*)::int as n from locations')).rows[0]?.n,
    ).toBe(0);
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', id]);
      expect(
        (await client.query<{ n: number }>('select count(*)::int as n from locations')).rows[0]?.n,
      ).toBe(1);
      expect(
        (
          await client.query<{ n: number }>(
            'select count(*)::int as n from owner_invitation_requests',
          )
        ).rows[0]?.n,
      ).toBe(1);
      await client.query('commit');
    } finally {
      client.release();
    }
  });

  it('does not expose provisioning to the application or grant direct table writes to the provisioner', async () => {
    const app = database.pool();
    await expect(
      app.query('select app.provision_tenant($1::uuid, $2::citext, $3::text, $4::text, $5::text)', [
        randomUUID(),
        'not-allowed',
        'Name',
        'Location',
        'owner@example.test',
      ]),
    ).rejects.toThrow();
    await expect(
      provisioner.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
        randomUUID(),
        'direct',
        'Direct',
      ]),
    ).rejects.toThrow();
    await expect(provisioner.query('select * from provisioning_requests')).rejects.toThrow();
    await expect(
      provisioner.query('update provisioning_limits set early_access_cap = 999'),
    ).rejects.toThrow();
    await expect(
      app.query('update provisioning_limits set early_access_cap = 999'),
    ).rejects.toThrow();
    await expect(provisioner.query('truncate table locations')).rejects.toThrow();
    await expect(provisioner.query('create table forbidden(id int)')).rejects.toThrow();
    for (const role of ['moin_owner', 'moin_migrator', 'moin_app']) {
      // eslint-disable-next-line no-restricted-syntax -- role identifier from a literal list only.
      await expect(provisioner.query(`set role ${role}`)).rejects.toThrow();
    }
    const roles = await admin.query<{
      rolname: string;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
    }>(
      `select rolname, rolbypassrls, rolcreaterole from pg_roles
       where rolname in ('moin_app', 'moin_provisioner', 'moin_migrator') order by rolname`,
    );
    expect(roles.rows.every((row) => !row.rolbypassrls && !row.rolcreaterole)).toBe(true);
    const id = await provision();
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', id]);
      await expect(
        client.query('update organisations set plan_code = $1 where id = $2', ['reception', id]),
      ).rejects.toThrow();
      await client.query('rollback');
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', id]);
      await expect(
        client.query('insert into organisations(id, slug, name) values ($1, $2, $3)', [
          randomUUID(),
          'direct-insert',
          'Direct',
        ]),
      ).rejects.toThrow();
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('rolls back the whole unit on a failure after organisation, location and setup inserts; retry succeeds', async () => {
    await admin.query(`create function public.reject_owner_request() returns trigger language plpgsql as $$
      begin raise exception 'injected failure'; end $$`);
    await admin.query(`create trigger reject_owner_request before insert on owner_invitation_requests
      for each row execute function public.reject_owner_request()`);
    const requestId = randomUUID();
    await expect(provision({ requestId, plan: 'reception', earlyAccess: true })).rejects.toThrow(
      /injected failure/u,
    );
    for (const table of [
      'organisations',
      'locations',
      'tenant_setup',
      'owner_invitation_requests',
      'provisioning_requests',
      'audit_events',
      'audit_heads',
    ] as const) {
      expect(await count(table)).toBe(0);
    }
    expect(
      (
        await admin.query<{ accepted_paid_early_access: number }>(
          'select accepted_paid_early_access from provisioning_limits',
        )
      ).rows[0]?.accepted_paid_early_access,
    ).toBe(0);
    await admin.query('drop trigger reject_owner_request on owner_invitation_requests');
    const id = await provision({ requestId, plan: 'reception', earlyAccess: true });
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await count('provisioning_requests')).toBe(1);
    expect(await count('audit_events')).toBe(1);
    expect(
      (
        await admin.query<{ accepted_paid_early_access: number }>(
          'select accepted_paid_early_access from provisioning_limits',
        )
      ).rows[0]?.accepted_paid_early_access,
    ).toBe(1);
  });

  it('rolls back tenant state and the cap if the audit append fails', async () => {
    await admin.query(`create function public.reject_provisioning_audit() returns trigger language plpgsql as $$
      begin raise exception 'injected audit failure'; end $$`);
    await admin.query(`create trigger reject_provisioning_audit before insert on audit_events
      for each row execute function public.reject_provisioning_audit()`);
    const requestId = randomUUID();
    await expect(provision({ requestId, plan: 'reception', earlyAccess: true })).rejects.toThrow(
      /injected audit failure/u,
    );
    for (const table of [
      'organisations',
      'locations',
      'tenant_setup',
      'owner_invitation_requests',
      'provisioning_requests',
      'audit_events',
      'audit_heads',
    ] as const) {
      expect(await count(table)).toBe(0);
    }
    const limit = await admin.query<{ accepted_paid_early_access: number }>(
      'select accepted_paid_early_access from provisioning_limits',
    );
    expect(limit.rows[0]?.accepted_paid_early_access).toBe(0);
    await admin.query('drop trigger reject_provisioning_audit on audit_events');
    const id = await provision({ requestId, plan: 'reception', earlyAccess: true });
    expect(await count('audit_events')).toBe(1);
    expect(await withTenant(database.pool(), id, verifyAuditChain)).toStrictEqual({
      valid: true,
      checked: '1',
    });
  });

  it('returns the same tenant for a repeated or racing request without duplicates', async () => {
    const requestId = randomUUID();
    const input = { requestId, slug: `repeat-${randomUUID().slice(0, 10)}` };
    const ids = await Promise.all([provision(input), provision(input), provision(input)]);
    expect(new Set(ids).size).toBe(1);
    expect(await count('organisations')).toBe(1);
    expect(await count('locations')).toBe(1);
    expect(await count('owner_invitation_requests')).toBe(1);
    expect(await count('audit_events')).toBe(1);
  });

  it('rejects duplicate slugs and malformed inputs without echoing them', async () => {
    const slug = `same-${randomUUID().slice(0, 10)}`;
    await provision({ slug });
    await expect(provision({ slug })).rejects.toThrow(/provisioning identifier already in use/u);
    const hostile = `x'); DROP TABLE organisations; --`;
    const badSlug = await provision({ slug: hostile }).catch((error: unknown) => error);
    expect(badSlug).toBeInstanceOf(Error);
    expect((badSlug as Error).message).toContain('invalid provisioning request');
    expect((badSlug as Error).message).not.toContain(hostile);
    expect(await count('organisations')).toBe(1);
    await expect(provision({ email: 'private-owner-email-without-at' })).rejects.toThrow(
      /invalid provisioning request/u,
    );
    await expect(provision({ timeZone: 'Not/A_Time_Zone' })).rejects.toThrow(
      /invalid provisioning request/u,
    );
    expect(await count('organisations')).toBe(1);
  });

  it('treats SQL-shaped names as data', async () => {
    const name = `'); DROP TABLE locations; --`;
    const id = await provision({ name });
    const result = await admin.query<{ name: string }>(
      'select name from organisations where id = $1',
      [id],
    );
    expect(result.rows[0]?.name).toBe(name);
    expect(await count('locations')).toBe(1);
  });

  it('keeps each new tenant invisible to another and retains FORCE RLS', async () => {
    const first = await provision();
    const second = await provision();
    const app = database.pool();
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', ['app.organisation_id', first]);
      const result = await client.query<{ id: string }>('select id from organisations');
      expect(result.rows.map((row) => row.id)).toStrictEqual([first]);
      expect(
        (
          await client.query<{ n: number }>(
            'select count(*)::int as n from locations where organisation_id = $1',
            [second],
          )
        ).rows[0]?.n,
      ).toBe(0);
      await client.query('commit');
    } finally {
      client.release();
    }
    const rls = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relname in ('organisations', 'locations', 'tenant_setup', 'owner_invitation_requests')`,
    );
    expect(rls.rows).toHaveLength(4);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});

describe('Early Access cap', () => {
  it('permits a paid tenant below the cap and the final fifth slot', async () => {
    for (let n = 0; n < 5; n += 1) await provision({ plan: 'reception', earlyAccess: true });
    expect(await count('organisations')).toBe(5);
  });

  it('rejects the sixth paid tenant without revealing other tenants', async () => {
    const requestId = randomUUID();
    const first = await provision({ requestId, plan: 'reception', earlyAccess: true });
    for (let n = 1; n < 5; n += 1) await provision({ plan: 'reception', earlyAccess: true });
    expect(await provision({ requestId, plan: 'reception', earlyAccess: true })).toBe(first);
    await expect(provision({ plan: 'reception', earlyAccess: true })).rejects.toThrow(
      /^Early Access cap reached$/u,
    );
    expect(await count('organisations')).toBe(5);
  });

  it('cannot be bypassed by marking a paid tenant as non-Early-Access', async () => {
    await expect(provision({ plan: 'reception', earlyAccess: false })).rejects.toThrow(
      /paid provisioning requires Early Access/u,
    );
    expect(await count('organisations')).toBe(0);
  });

  it('counts paid Early Access tenants, while pilot tenants do not consume slots', async () => {
    for (let n = 0; n < 3; n += 1) await provision({ plan: 'pilot', earlyAccess: true });
    for (let n = 0; n < 5; n += 1) await provision({ plan: 'reception', earlyAccess: true });
    expect(await count('organisations')).toBe(8);
    await expect(provision({ plan: 'front_office', earlyAccess: true })).rejects.toThrow(
      /Early Access cap reached/u,
    );
  });

  it('serialises simultaneous requests for the final slot', async () => {
    for (let n = 0; n < 4; n += 1) await provision({ plan: 'reception', earlyAccess: true });
    const outcomes = await Promise.allSettled([
      provision({ plan: 'reception', earlyAccess: true }),
      provision({ plan: 'reception', earlyAccess: true }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await count('organisations')).toBe(5);
  });

  it('ignores a provisioner-created temporary table that shadows the cap table', async () => {
    for (let n = 0; n < 5; n += 1) await provision({ plan: 'reception', earlyAccess: true });
    const client = await provisioner.connect();
    try {
      await client.query(`create temporary table provisioning_limits (
        id boolean, accepted_paid_early_access integer, early_access_cap integer, updated_at timestamptz
      )`);
      await client.query('insert into pg_temp.provisioning_limits values (true, 0, 999, now())');
      await expect(
        client.query(
          'select app.provision_tenant($1::uuid, $2::citext, $3::text, $4::text, $5::text, $6::text, $7::text, $8::boolean, $9::text)',
          [
            randomUUID(),
            `shadow-${randomUUID().slice(0, 10)}`,
            'Name',
            'Location',
            'owner@example.test',
            'restaurant@1.0',
            'reception',
            true,
            'Europe/Berlin',
          ],
        ),
      ).rejects.toThrow(/^Early Access cap reached$/u);
    } finally {
      client.release();
    }
    expect(await count('organisations')).toBe(5);
  });
});
