/**
 * The catalog check, checked (P06.02.07).
 *
 * A guard that has never fired is a guard nobody has tested, and this one guards tenant isolation.
 * Each case below builds the mistake it is meant to catch — in a private database, against the
 * real catalog — and asserts that the check reports it. The first case is the one PLAN names: a
 * table with row-level security enabled but not FORCEd, which is the failure that looks fine.
 */

import { createTestDatabase, type TestDatabase } from '@moin/testing';
import { createPool } from '@moin/db/pool';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspect, allowlistedDefiners, type Finding } from './check-rls-catalog.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let database: TestDatabase;

/** Runs DDL as the migration role, which is the only role permitted to. */
async function ddl(sql: string): Promise<void> {
  const pool = createPool({ connectionString: database.migrationUrl, max: 1 });
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function findings(): Promise<Finding[]> {
  return inspect(database.migrationUrl);
}

function rulesFor(list: readonly Finding[], subject: string): string[] {
  return list
    .filter((f) => f.subject === subject)
    .map((f) => f.rule)
    .sort();
}

beforeAll(async () => {
  database = await createTestDatabase('rls-catalog');
}, 60_000);

afterAll(async () => {
  await database.drop();
});

describe('the migrated schema', () => {
  it('has no findings', async () => {
    expect(await findings()).toStrictEqual([]);
  });
});

describe('the QG-09 provisioning registration', () => {
  it('rejects the same function without its documented registration', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'moin-definers-'));
    try {
      const path = join(directory, 'allowlist.md');
      writeFileSync(path, '| Function | Why | Role |\n| --- | --- | --- |\n');
      expect(allowlistedDefiners(path).has('app.provision_tenant')).toBe(false);
      expect(
        rulesFor(await inspect(database.migrationUrl, path), 'app.provision_tenant'),
      ).toContain('security-definer-not-allowlisted');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a mutable search path on the registered function', async () => {
    // eslint-disable-next-line no-restricted-syntax -- DDL fixture deliberately mutates the function-level setting, not a pooled session.
    await ddl(`ALTER FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)
      SET search_path = public, app, pg_catalog`);
    expect(rulesFor(await findings(), 'app.provision_tenant')).toContain(
      'security-definer-unsafe-search-path',
    );
    // eslint-disable-next-line no-restricted-syntax -- Restore the reviewed function-level setting for subsequent fixtures.
    await ddl(`ALTER FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)
      SET search_path = pg_catalog, public, app, pg_temp`);
  });

  it('rejects an unexpected EXECUTE grant', async () => {
    await ddl(
      'GRANT EXECUTE ON FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text) TO moin_app',
    );
    expect(rulesFor(await findings(), 'app.provision_tenant')).toContain(
      'security-definer-unexpected-execute-grant',
    );
    await ddl(
      'REVOKE EXECUTE ON FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text) FROM moin_app',
    );
  });

  it('rejects an unreviewed function owner', async () => {
    await ddl(`ALTER FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)
      OWNER TO moin_app`);
    try {
      expect(rulesFor(await findings(), 'app.provision_tenant')).toContain(
        'security-definer-unsafe-owner',
      );
    } finally {
      await ddl(`ALTER FUNCTION app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)
        OWNER TO moin_migrator`);
    }
  });
});

describe('what the check catches', () => {
  // The case PLAN names. ENABLE without FORCE reads as protected and is not: the policy does not
  // apply to the table's owner, who runs migrations, backfills and admin connections.
  it('a tenant table with row-level security enabled but not forced', async () => {
    await ddl(`
      CREATE TABLE enabled_not_forced (
        organisation_id uuid NOT NULL,
        id uuid NOT NULL PRIMARY KEY,
        UNIQUE (organisation_id, id)
      );
      ALTER TABLE enabled_not_forced ENABLE ROW LEVEL SECURITY;
      CREATE POLICY p ON enabled_not_forced
        USING (organisation_id = app.current_org())
        WITH CHECK (organisation_id = app.current_org());
    `);
    expect(rulesFor(await findings(), 'enabled_not_forced')).toStrictEqual(['rls-not-forced']);
  });

  it('a tenant table with no row-level security at all', async () => {
    await ddl(`
      CREATE TABLE no_rls (
        organisation_id uuid NOT NULL,
        id uuid NOT NULL PRIMARY KEY,
        UNIQUE (organisation_id, id)
      );
    `);
    expect(rulesFor(await findings(), 'no_rls')).toStrictEqual([
      'no-policy',
      'rls-not-enabled',
      'rls-not-forced',
    ]);
  });

  // Reads correctly, passes every read test, and lets a row be written into another tenant.
  it('a policy with USING and no WITH CHECK', async () => {
    await ddl(`
      CREATE TABLE using_only (
        organisation_id uuid NOT NULL,
        id uuid NOT NULL PRIMARY KEY,
        UNIQUE (organisation_id, id)
      );
      ALTER TABLE using_only ENABLE ROW LEVEL SECURITY;
      ALTER TABLE using_only FORCE ROW LEVEL SECURITY;
      CREATE POLICY p ON using_only USING (organisation_id = app.current_org());
    `);
    expect(rulesFor(await findings(), 'using_only')).toStrictEqual(['policy-without-with-check']);
  });

  it('a tenant table with no composite unique key', async () => {
    await ddl(`
      CREATE TABLE no_composite (organisation_id uuid NOT NULL, id uuid NOT NULL PRIMARY KEY);
      SELECT app.apply_tenant_rls('no_composite');
    `);
    expect(rulesFor(await findings(), 'no_composite')).toStrictEqual(['no-composite-unique']);
  });

  // Row-level security stops a query returning another tenant's row. It does not stop a row
  // pointing at one, and a single-column foreign key is how that happens.
  it('a foreign key between tenant tables that omits organisation_id', async () => {
    await ddl(`
      CREATE TABLE fk_child (
        organisation_id uuid NOT NULL,
        id uuid NOT NULL PRIMARY KEY,
        location_id uuid NOT NULL REFERENCES locations (id),
        UNIQUE (organisation_id, id)
      );
      SELECT app.apply_tenant_rls('fk_child');
    `);
    const list = await findings();
    const fk = list.filter((f) => f.rule === 'foreign-key-not-composite');
    expect(fk).toHaveLength(1);
    expect(fk[0]?.subject).toMatch(/^fk_child\./u);
  });

  it('a table with no tenant column that is not on the global register', async () => {
    await ddl('CREATE TABLE forgot_the_column (id uuid NOT NULL PRIMARY KEY);');
    expect(rulesFor(await findings(), 'forgot_the_column')).toStrictEqual([
      'unregistered-global-table',
    ]);
  });

  it('a SECURITY DEFINER function that is neither allowlisted nor pinned', async () => {
    await ddl(`
      CREATE FUNCTION public.sneaky() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    `);
    expect(rulesFor(await findings(), 'public.sneaky')).toStrictEqual([
      'security-definer-not-allowlisted',
      'security-definer-unpinned-search-path',
    ]);
  });

  it('reports every finding at once rather than the first', async () => {
    const list = await findings();
    expect(new Set(list.map((f) => f.subject)).size).toBeGreaterThan(4);
  });
});
