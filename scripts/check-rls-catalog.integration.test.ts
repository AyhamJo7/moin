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

describe('the QG-09 audit registration', () => {
  it('rejects a missing reviewed audit writer signature', async () => {
    await ddl(
      `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) RENAME TO append_audit_event_mutant`,
    );
    try {
      expect(rulesFor(await findings(), 'app.append_audit_event')).toContain(
        'reviewed-function-missing',
      );
      expect(rulesFor(await findings(), 'app.append_audit_event_mutant')).toContain(
        'security-definer-not-allowlisted',
      );
    } finally {
      await ddl(
        `ALTER FUNCTION app.append_audit_event_mutant(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) RENAME TO append_audit_event`,
      );
    }
  });

  it('rejects a reviewed audit writer changed to SECURITY INVOKER', async () => {
    await ddl(
      `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) SECURITY INVOKER`,
    );
    try {
      expect(rulesFor(await findings(), 'app.append_audit_event')).toContain(
        'reviewed-function-not-security-definer',
      );
    } finally {
      await ddl(
        `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) SECURITY DEFINER`,
      );
    }
  });

  it('rejects the exact audit writer without its documented registration', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'moin-audit-definers-'));
    try {
      const path = join(directory, 'allowlist.md');
      writeFileSync(path, '| Function | Why | Role |\n| --- | --- | --- |\n');
      expect(
        rulesFor(await inspect(database.migrationUrl, path), 'app.append_audit_event'),
      ).toContain('security-definer-not-allowlisted');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an unsafe audit writer path and extra runtime grant', async () => {
    await ddl(
      // eslint-disable-next-line no-restricted-syntax -- defective function-level setting is the negative control.
      `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) SET search_path = public, app, pg_catalog`,
    );
    try {
      expect(rulesFor(await findings(), 'app.append_audit_event')).toContain(
        'security-definer-unsafe-search-path',
      );
    } finally {
      await ddl(
        // eslint-disable-next-line no-restricted-syntax -- restore the reviewed setting.
        `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) SET search_path = pg_catalog, public, app, pg_temp`,
      );
    }
    await ddl(
      `GRANT EXECUTE ON FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) TO moin_provisioner`,
    );
    try {
      expect(rulesFor(await findings(), 'app.append_audit_event')).toContain(
        'security-definer-unexpected-execute-grant',
      );
    } finally {
      await ddl(
        `REVOKE EXECUTE ON FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) FROM moin_provisioner`,
      );
    }
  });

  it('rejects an unreviewed audit writer owner', async () => {
    await ddl(
      `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) OWNER TO moin_app`,
    );
    try {
      expect(rulesFor(await findings(), 'app.append_audit_event')).toContain(
        'security-definer-unsafe-owner',
      );
    } finally {
      await ddl(
        `ALTER FUNCTION app.append_audit_event(uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text) OWNER TO moin_migrator`,
      );
    }
  });
});

describe('audit append-only catalog control', () => {
  it('rejects a disabled mutation guard', async () => {
    await ddl('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    try {
      expect(rulesFor(await findings(), 'audit_events.audit_events_append_only')).toContain(
        'audit-append-only-trigger-unsafe',
      );
    } finally {
      await ddl('ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_append_only');
    }

    // `ENABLE` alone is "origin only", which replica mode skips — the weaker of the two states,
    // and the one a careless restore leaves behind.
    await ddl('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
    try {
      expect(rulesFor(await findings(), 'audit_events.audit_events_append_only')).toContain(
        'audit-append-only-trigger-unsafe',
      );
    } finally {
      await ddl('ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_append_only');
    }
  });

  it('rejects a dropped mutation guard', async () => {
    await ddl('DROP TRIGGER audit_events_append_only ON audit_events');
    try {
      expect(rulesFor(await findings(), 'audit_events.audit_events_append_only')).toContain(
        'audit-append-only-trigger-missing',
      );
    } finally {
      await ddl(`CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation()`);
      await ddl('ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_append_only');
    }
  });
});

describe('audit chain verification catalog controls', () => {
  it('rejects a disabled and a dropped register guard', async () => {
    // A deletable registration is how a whole tenant's chain disappears from the daily sweep while
    // the sweep keeps reporting that it found nothing wrong.
    await ddl('ALTER TABLE audit_chain_registry DISABLE TRIGGER audit_chain_registry_append_only');
    try {
      expect(
        rulesFor(await findings(), 'audit_chain_registry.audit_chain_registry_append_only'),
      ).toContain('audit-append-only-trigger-unsafe');
    } finally {
      await ddl(
        'ALTER TABLE audit_chain_registry ENABLE ALWAYS TRIGGER audit_chain_registry_append_only',
      );
    }

    await ddl('DROP TRIGGER audit_chain_registry_append_only ON audit_chain_registry');
    try {
      expect(
        rulesFor(await findings(), 'audit_chain_registry.audit_chain_registry_append_only'),
      ).toContain('audit-append-only-trigger-missing');
    } finally {
      await ddl(`CREATE TRIGGER audit_chain_registry_append_only
        BEFORE UPDATE OR DELETE ON audit_chain_registry
        FOR EACH ROW EXECUTE FUNCTION app.reject_registry_mutation()`);
      await ddl(
        'ALTER TABLE audit_chain_registry ENABLE ALWAYS TRIGGER audit_chain_registry_append_only',
      );
    }
  });

  it('rejects a register guard repointed at a function that does not reject', async () => {
    await ddl(
      // eslint-disable-next-line no-restricted-syntax -- function-level setting in a DDL fixture, not a pooled session.
      `
      CREATE FUNCTION app.pretend_reject() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN RETURN NEW; END $$;
      DROP TRIGGER audit_chain_registry_append_only ON audit_chain_registry;
      CREATE TRIGGER audit_chain_registry_append_only
        BEFORE UPDATE OR DELETE ON audit_chain_registry
        FOR EACH ROW EXECUTE FUNCTION app.pretend_reject();
    `,
    );
    try {
      expect(
        rulesFor(await findings(), 'audit_chain_registry.audit_chain_registry_append_only'),
      ).toContain('audit-append-only-trigger-unsafe');
    } finally {
      await ddl(`DROP TRIGGER audit_chain_registry_append_only ON audit_chain_registry;
        CREATE TRIGGER audit_chain_registry_append_only
          BEFORE UPDATE OR DELETE ON audit_chain_registry
          FOR EACH ROW EXECUTE FUNCTION app.reject_registry_mutation();
        ALTER TABLE audit_chain_registry
          ENABLE ALWAYS TRIGGER audit_chain_registry_append_only;
        DROP FUNCTION app.pretend_reject();`);
    }
  });

  it('rejects a dropped and a disabled chain-registration trigger', async () => {
    // Without it a newly provisioned tenant is never registered, so the verifier silently stops
    // covering it — and silence is what a clean run looks like.
    await ddl('DROP TRIGGER organisations_register_audit_chain ON organisations');
    try {
      expect(rulesFor(await findings(), 'organisations')).toContain(
        'audit-chain-registration-trigger-unsafe',
      );
    } finally {
      await ddl(`CREATE TRIGGER organisations_register_audit_chain AFTER INSERT ON organisations
        FOR EACH ROW EXECUTE FUNCTION app.register_audit_chain()`);
      await ddl(
        'ALTER TABLE organisations ENABLE ALWAYS TRIGGER organisations_register_audit_chain',
      );
    }

    await ddl('ALTER TABLE organisations DISABLE TRIGGER organisations_register_audit_chain');
    try {
      expect(rulesFor(await findings(), 'organisations')).toContain(
        'audit-chain-registration-trigger-unsafe',
      );
    } finally {
      await ddl(
        'ALTER TABLE organisations ENABLE ALWAYS TRIGGER organisations_register_audit_chain',
      );
    }
  });

  it('rejects a guard whose body was replaced with one that does not raise', async () => {
    // The cheapest attack on a guard, and the one every identity rule misses: same OID, same name,
    // same owner, same signature, same trigger — a body that just returns.
    await ddl(
      // eslint-disable-next-line no-restricted-syntax -- function-level setting in a DDL fixture, not a pooled session.
      `CREATE OR REPLACE FUNCTION app.reject_registry_mutation() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog
      AS $$ BEGIN RETURN NEW; END $$`,
    );
    try {
      expect(rulesFor(await findings(), 'app.reject_registry_mutation')).toStrictEqual([
        'reviewed-function-body-changed',
      ]);
    } finally {
      await ddl(
        // eslint-disable-next-line no-restricted-syntax -- restoring the reviewed function-level setting.
        `CREATE OR REPLACE FUNCTION app.reject_registry_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'audit chain registrations are append-only' USING ERRCODE = 'insufficient_privilege';
END $$`,
      );
    }
    // The restore has to bring the digest back, or every later case would inherit the finding.
    expect(rulesFor(await findings(), 'app.reject_registry_mutation')).toStrictEqual([]);
  });

  it('rejects a register that does not account for every provisioned tenant', async () => {
    // The register is otherwise its own witness: disabling the registration trigger around one
    // insert leaves nothing in the catalog to find afterwards.
    // A literal rather than an interpolated value: the lint rule that forbids building SQL by
    // interpolation is right, and `ddl()` takes no parameters.
    await ddl('ALTER TABLE organisations DISABLE TRIGGER organisations_register_audit_chain');
    await ddl('ALTER TABLE provisioning_requests DISABLE TRIGGER provisioning_request_audit');
    try {
      await ddl(`INSERT INTO organisations(id, slug, name)
        VALUES ('19191919-1919-4919-8919-191919191919', 'catalog-hidden', 'Hidden')`);
      await ddl(`INSERT INTO provisioning_requests(request_id, tenant_id)
        VALUES (gen_random_uuid(), '19191919-1919-4919-8919-191919191919')`);
      expect(rulesFor(await findings(), 'audit_chain_registry')).toContain(
        'audit-chain-registry-incomplete',
      );
    } finally {
      await ddl(`DELETE FROM provisioning_requests
        WHERE tenant_id = '19191919-1919-4919-8919-191919191919'`);
      await ddl(`DELETE FROM organisations WHERE id = '19191919-1919-4919-8919-191919191919'`);
      await ddl('ALTER TABLE provisioning_requests ENABLE TRIGGER provisioning_request_audit');
      await ddl(
        'ALTER TABLE organisations ENABLE ALWAYS TRIGGER organisations_register_audit_chain',
      );
    }
  });

  it('rejects the claim function changed to SECURITY INVOKER', async () => {
    // As SECURITY INVOKER it returns nothing at all — FORCE RLS hides the register from the caller —
    // so the sweep would verify zero tenants and report a clean run.
    await ddl('ALTER FUNCTION app.claim_audit_chains(integer, bigint, bigint) SECURITY INVOKER');
    try {
      expect(rulesFor(await findings(), 'app.claim_audit_chains')).toStrictEqual([
        'reviewed-function-not-security-definer',
      ]);
    } finally {
      await ddl('ALTER FUNCTION app.claim_audit_chains(integer, bigint, bigint) SECURITY DEFINER');
    }
  });

  it('rejects a missing reviewed claim function signature', async () => {
    await ddl('DROP FUNCTION app.claim_audit_chains(integer, bigint, bigint)');
    try {
      // Two findings, because identity and body are pinned separately and both are now absent.
      expect(rulesFor(await findings(), 'app.claim_audit_chains')).toStrictEqual([
        'reviewed-function-body-missing',
        'reviewed-function-missing',
      ]);
    } finally {
      await ddl(
        // eslint-disable-next-line no-restricted-syntax -- function-level setting in a DDL fixture, not a pooled session.
        `CREATE FUNCTION app.claim_audit_chains(p_limit integer, p_after bigint, p_high_water bigint)
          RETURNS TABLE (organisation_id uuid, id uuid, registration_seq bigint)
          LANGUAGE sql STABLE SECURITY DEFINER
          SET search_path = pg_catalog, public, app, pg_temp
        AS $$
  SELECT r.tenant_id AS organisation_id, r.tenant_id AS id, r.registration_seq
  FROM audit_chain_registry r
  WHERE r.registration_seq > coalesce(p_after, 0)
    AND r.registration_seq <= coalesce(p_high_water, 0)
  ORDER BY r.registration_seq
  LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000)
$$;
        REVOKE ALL ON FUNCTION app.claim_audit_chains(integer, bigint, bigint) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION app.claim_audit_chains(integer, bigint, bigint) TO moin_app;`,
      );
    }
  });

  it('rejects a mutable path and an extra runtime grant on the claim function', async () => {
    await ddl(
      // eslint-disable-next-line no-restricted-syntax -- defective function-level setting is the negative control.
      `ALTER FUNCTION app.claim_audit_chains(integer, bigint, bigint) SET search_path = public, pg_temp`,
    );
    try {
      expect(rulesFor(await findings(), 'app.claim_audit_chains')).toContain(
        'security-definer-unsafe-search-path',
      );
    } finally {
      await ddl(
        // eslint-disable-next-line no-restricted-syntax -- restore the reviewed setting.
        `ALTER FUNCTION app.claim_audit_chains(integer, bigint, bigint) SET search_path = pg_catalog, public, app, pg_temp`,
      );
    }

    await ddl(
      'GRANT EXECUTE ON FUNCTION app.claim_audit_chains(integer, bigint, bigint) TO moin_reporting',
    );
    try {
      expect(rulesFor(await findings(), 'app.claim_audit_chains')).toContain(
        'security-definer-unexpected-execute-grant',
      );
    } finally {
      await ddl(
        'REVOKE EXECUTE ON FUNCTION app.claim_audit_chains(integer, bigint, bigint) FROM moin_reporting',
      );
    }
  });

  it('rejects the exact claim function without its documented registration', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'moin-definers-'));
    try {
      const path = join(directory, 'allowlist.md');
      writeFileSync(path, '| Function | Why | Role |\n| --- | --- | --- |\n');
      expect(allowlistedDefiners(path).has('app.claim_audit_chains')).toBe(false);
      const list = await inspect(database.migrationUrl, path);
      expect(rulesFor(list, 'app.claim_audit_chains')).toContain(
        'security-definer-not-allowlisted',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
