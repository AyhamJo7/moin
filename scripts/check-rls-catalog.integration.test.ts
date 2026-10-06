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
import { randomBytes } from 'node:crypto';
import {
  inspect,
  inspectIdentityRole,
  allowlistedDefiners,
  type Finding,
} from './check-rls-catalog.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evidenceTest } from '@moin/testing';

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
  evidenceTest('rejects a disabled mutation guard', async () => {
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
  evidenceTest('rejects a disabled and a dropped register guard', async () => {
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

  evidenceTest('rejects a dropped and a disabled chain-registration trigger', async () => {
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

  evidenceTest('rejects a guard whose body was replaced with one that does not raise', async () => {
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

  evidenceTest(
    'rejects a register that does not account for every provisioned tenant',
    async () => {
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
    },
  );

  evidenceTest('rejects the claim function changed to SECURITY INVOKER', async () => {
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

describe('the identity role boundary (P06.06, ADR-0003)', () => {
  // Grants here are per-database objects, so they cannot leak into another test file's database.
  // Role membership is cluster-wide and is therefore asserted by the migration and the role tests,
  // never mutated here.
  evidenceTest('rejects moin_app regaining EXECUTE on a session function', async () => {
    await ddl(
      'GRANT EXECUTE ON FUNCTION app.begin_session(text, bytea, uuid, bytea, text, bytea, boolean) TO moin_app',
    );
    try {
      expect(rulesFor(await findings(), 'app.begin_session')).toContain(
        'security-definer-unexpected-execute-grant',
      );
    } finally {
      await ddl(
        'REVOKE EXECUTE ON FUNCTION app.begin_session(text, bytea, uuid, bytea, text, bytea, boolean) FROM moin_app',
      );
    }
  });

  evidenceTest('rejects moin_identity holding a table privilege, session or tenant', async () => {
    for (const table of ['sessions', 'organisations']) {
      // eslint-disable-next-line no-restricted-syntax -- table name from a two-entry literal list in this test.
      await ddl(`GRANT SELECT ON TABLE ${table} TO moin_identity`);
      try {
        expect(rulesFor(await findings(), 'moin_identity'), table).toContain(
          'identity-role-table-privilege',
        );
      } finally {
        // eslint-disable-next-line no-restricted-syntax -- same literal list.
        await ddl(`REVOKE SELECT ON TABLE ${table} FROM moin_identity`);
      }
    }
  });

  evidenceTest('rejects moin_identity executing any other privileged function', async () => {
    const signature =
      'app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)';
    // eslint-disable-next-line no-restricted-syntax -- signature is a literal in this test.
    await ddl(`GRANT EXECUTE ON FUNCTION ${signature} TO moin_identity`);
    try {
      const list = await findings();
      expect(rulesFor(list, 'moin_identity')).toContain('identity-role-unexpected-execute');
      expect(rulesFor(list, 'app.provision_tenant')).toContain(
        'security-definer-unexpected-execute-grant',
      );
    } finally {
      // eslint-disable-next-line no-restricted-syntax -- same literal.
      await ddl(`REVOKE EXECUTE ON FUNCTION ${signature} FROM moin_identity`);
    }
  });

  /** Applies `grant`, asserts `rule` is reported for `subject`, and always applies `revoke`. */
  async function fires(
    grant: string,
    revoke: string,
    subject: string,
    rule: string,
  ): Promise<void> {
    await ddl(grant);
    try {
      expect(rulesFor(await findings(), subject), grant).toContain(rule);
    } finally {
      await ddl(revoke);
    }
  }

  evidenceTest(
    'rejects a column privilege, MAINTAIN or a grant option held by moin_identity',
    async () => {
      await fires(
        'GRANT SELECT (cognito_sub, email) ON TABLE users TO moin_identity',
        'REVOKE SELECT (cognito_sub, email) ON TABLE users FROM moin_identity',
        'moin_identity',
        'identity-role-table-privilege',
      );
      await fires(
        'GRANT MAINTAIN ON TABLE sessions TO moin_identity',
        'REVOKE MAINTAIN ON TABLE sessions FROM moin_identity',
        'moin_identity',
        'identity-role-table-privilege',
      );
      await fires(
        'GRANT EXECUTE ON FUNCTION app.resolve_session(bytea) TO moin_identity WITH GRANT OPTION',
        'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION app.resolve_session(bytea) FROM moin_identity',
        'moin_identity',
        'identity-role-grant-option',
      );
    },
  );

  evidenceTest('rejects moin_identity holding any grant on memberships', async () => {
    // The session credential reaches tenant rows only through the pinned DEFINER join; a direct
    // grant would silently open that path (M1 drift guard).
    await fires(
      'GRANT SELECT ON TABLE memberships TO moin_identity',
      'REVOKE SELECT ON TABLE memberships FROM moin_identity',
      'memberships',
      'identity-role-membership-privilege',
    );
  });

  evidenceTest('rejects moin_identity being able to create anything', async () => {
    await fires(
      'GRANT CREATE ON SCHEMA app TO moin_identity',
      'REVOKE CREATE ON SCHEMA app FROM moin_identity',
      'moin_identity',
      'identity-role-schema-create',
    );
    const database_ = `"${database.name}"`;
    await fires(
      // eslint-disable-next-line no-restricted-syntax -- the harness-generated database name, never input.
      `GRANT TEMPORARY ON DATABASE ${database_} TO moin_identity`,
      // eslint-disable-next-line no-restricted-syntax -- the harness-generated database name, never input.
      `REVOKE TEMPORARY ON DATABASE ${database_} FROM moin_identity`,
      'moin_identity',
      'identity-role-temporary',
    );
    await fires(
      // eslint-disable-next-line no-restricted-syntax -- the harness-generated database name, never input.
      `GRANT CREATE ON DATABASE ${database_} TO moin_identity`,
      // eslint-disable-next-line no-restricted-syntax -- the harness-generated database name, never input.
      `REVOKE CREATE ON DATABASE ${database_} FROM moin_identity`,
      'moin_identity',
      'identity-role-database-create',
    );
  });

  evidenceTest('rejects moin_identity being able to connect to another database', async () => {
    // A throwaway database, so no database another test or worktree uses is touched. Other
    // databases on a shared test cluster may already be reachable, so the assertion is about this
    // one by name.
    const other = `zz_identity_db_${randomBytes(4).toString('hex')}`;
    const reaches = async (): Promise<boolean> =>
      (await findings()).some(
        (f) => f.rule === 'identity-role-other-database' && f.detail.includes(other),
      );
    /* eslint-disable no-restricted-syntax -- database DDL cannot be parameterised; the name is a literal prefix and generated hex. */
    await ddl(`CREATE DATABASE ${other}`);
    try {
      await ddl(`REVOKE CONNECT ON DATABASE ${other} FROM PUBLIC`);
      expect(await reaches()).toBe(false);
      await ddl(`GRANT CONNECT ON DATABASE ${other} TO moin_identity`);
      expect(await reaches()).toBe(true);
    } finally {
      await ddl(`DROP DATABASE IF EXISTS ${other} WITH (FORCE)`);
    }
    /* eslint-enable no-restricted-syntax */
  });

  evidenceTest(
    'rejects any other runtime role holding a privilege on a session table',
    async () => {
      await fires(
        'GRANT INSERT ON TABLE sessions TO moin_app',
        'REVOKE INSERT ON TABLE sessions FROM moin_app',
        'sessions',
        'session-table-privilege',
      );
      await fires(
        'GRANT INSERT ON TABLE auth_transactions TO moin_dispatcher',
        'REVOKE INSERT ON TABLE auth_transactions FROM moin_dispatcher',
        'auth_transactions',
        'session-table-privilege',
      );
    },
  );

  evidenceTest(
    'rejects an extension view reaching a sensitive relation through an intermediate view',
    async () => {
      await ddl(
        'CREATE VIEW zz_inner_probe AS SELECT id FROM sessions; CREATE VIEW zz_outer_probe AS SELECT id FROM zz_inner_probe; GRANT SELECT ON zz_outer_probe TO PUBLIC',
      );
      const pool = createPool({ connectionString: database.migrationUrl, max: 1 });
      try {
        await ddl('ALTER EXTENSION pgcrypto ADD VIEW zz_outer_probe');
        try {
          // Single-hop logic would see only zz_inner_probe (not sensitive) and pass; the
          // transitive closure must still fire, even when explicitly allowlisted.
          const allowlisted = await inspectIdentityRole(pool, 'moin_identity', {
            allowedExtensionViews: [
              { schema: 'public', name: 'zz_outer_probe', extension: 'pgcrypto' },
            ],
          });
          expect(allowlisted.some((f) => f.rule === 'identity-role-table-privilege')).toBe(true);
        } finally {
          await ddl('ALTER EXTENSION pgcrypto DROP VIEW zz_outer_probe');
        }
      } finally {
        await pool.end();
        await ddl('DROP VIEW IF EXISTS zz_outer_probe; DROP VIEW IF EXISTS zz_inner_probe');
      }
    },
  );

  evidenceTest('rejects an extension-owned view exposing sensitive session columns', async () => {
    // Codex regression: an extension-owned view exposing sessions.id, user_id, provider_tokens_sealed
    // must not be exempted by the catalog checker.
    await ddl(
      'CREATE VIEW zz_extension_leak_probe AS SELECT id, user_id, provider_tokens_sealed FROM sessions; GRANT SELECT ON zz_extension_leak_probe TO PUBLIC',
    );
    const pool = createPool({ connectionString: database.migrationUrl, max: 1 });
    try {
      await ddl('ALTER EXTENSION pgcrypto ADD VIEW zz_extension_leak_probe');
      try {
        expect(rulesFor(await findings(), 'moin_identity')).toContain(
          'identity-role-table-privilege',
        );
        // Even if explicitly submitted to allowedExtensionViews, it must be rejected due to sensitive table dependency:
        const allowlistedAttempt = await inspectIdentityRole(pool, 'moin_identity', {
          allowedExtensionViews: [
            { schema: 'public', name: 'zz_extension_leak_probe', extension: 'pgcrypto' },
          ],
        });
        expect(allowlistedAttempt.some((f) => f.rule === 'identity-role-table-privilege')).toBe(
          true,
        );
      } finally {
        await ddl('ALTER EXTENSION pgcrypto DROP VIEW zz_extension_leak_probe');
      }
    } finally {
      await pool.end();
      await ddl('DROP VIEW IF EXISTS zz_extension_leak_probe');
    }
  });

  evidenceTest('an unreviewed extension view is never silently tolerated', async () => {
    await ddl(
      'CREATE VIEW zz_safe_extension_probe AS SELECT 1 AS x; GRANT SELECT ON zz_safe_extension_probe TO PUBLIC',
    );
    const pool = createPool({ connectionString: database.migrationUrl, max: 1 });
    try {
      await ddl('ALTER EXTENSION pgcrypto ADD VIEW zz_safe_extension_probe');
      try {
        // Unallowlisted: fails — no blanket exemption for extension-owned views.
        const unallowlisted = await inspectIdentityRole(pool, 'moin_identity');
        expect(unallowlisted.some((f) => f.rule === 'identity-role-table-privilege')).toBe(true);
      } finally {
        await ddl('ALTER EXTENSION pgcrypto DROP VIEW zz_safe_extension_probe');
      }
    } finally {
      await pool.end();
      await ddl('DROP VIEW IF EXISTS zz_safe_extension_probe');
    }
  });

  evidenceTest(
    'tolerates only an explicitly reviewed safe extension view with no sensitive dependencies',
    async () => {
      await ddl(
        'CREATE VIEW zz_safe_extension_probe AS SELECT 1 AS x; GRANT SELECT ON zz_safe_extension_probe TO PUBLIC',
      );
      const pool = createPool({ connectionString: database.migrationUrl, max: 1 });
      try {
        await ddl('ALTER EXTENSION pgcrypto ADD VIEW zz_safe_extension_probe');
        try {
          // Explicitly allowlisted with no sensitive dependencies: passes
          const allowlisted = await inspectIdentityRole(pool, 'moin_identity', {
            allowedExtensionViews: [
              { schema: 'public', name: 'zz_safe_extension_probe', extension: 'pgcrypto' },
            ],
          });
          expect(allowlisted.some((f) => f.rule === 'identity-role-table-privilege')).toBe(false);

          // If write privilege is added: fails even if allowlisted
          await ddl('GRANT INSERT ON zz_safe_extension_probe TO PUBLIC');
          const writable = await inspectIdentityRole(pool, 'moin_identity', {
            allowedExtensionViews: [
              { schema: 'public', name: 'zz_safe_extension_probe', extension: 'pgcrypto' },
            ],
          });
          expect(writable.some((f) => f.rule === 'identity-role-table-privilege')).toBe(true);
        } finally {
          await ddl('ALTER EXTENSION pgcrypto DROP VIEW zz_safe_extension_probe');
        }
      } finally {
        await pool.end();
        await ddl('DROP VIEW IF EXISTS zz_safe_extension_probe');
      }
    },
  );

  /* eslint-disable no-restricted-syntax -- role DDL cannot be parameterised; the names are built in this test from a literal prefix and generated hex, and `SET FALSE` is a GRANT option, not a session-level SET. */
  evidenceTest(
    'tolerates only an ADMIN-only grant to the role that created it (RDS, PostgreSQL 16+)',
    async () => {
      // Throwaway roles: membership is cluster-wide, so moin_identity itself is never touched here.
      const suffix = randomBytes(4).toString('hex');
      const probe = `zz_identity_probe_${suffix}`;
      const creator = `zz_identity_creator_${suffix}`;
      const plain = `zz_identity_plain_${suffix}`;
      await ddl(
        `CREATE ROLE ${probe} NOLOGIN; CREATE ROLE ${creator} NOLOGIN CREATEROLE; CREATE ROLE ${plain} NOLOGIN`,
      );
      const pool = createPool({ connectionString: database.migrationUrl, max: 1 });
      const membership = async (): Promise<boolean> =>
        (await inspectIdentityRole(pool, probe)).some((f) => f.rule === 'identity-role-membership');
      const adminOnly = (holder: string) =>
        ddl(`GRANT ${probe} TO ${holder} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
      try {
        expect(await membership(), 'no members').toBe(false);

        await adminOnly(creator);
        expect(await membership(), 'ADMIN-only grant to its CREATEROLE creator').toBe(false);
        // A runtime role that can reach the creator could grant itself the role through it.
        await ddl(`GRANT ${creator} TO moin_reporting WITH INHERIT FALSE, SET FALSE`);
        try {
          expect(await membership(), 'creator reachable from a runtime role').toBe(true);
        } finally {
          await ddl(`REVOKE ${creator} FROM moin_reporting`);
        }
        await ddl(`REVOKE ${probe} FROM ${creator}`);

        await adminOnly(plain);
        expect(await membership(), 'ADMIN-only grant to a role without CREATEROLE').toBe(true);
        await ddl(`REVOKE ${probe} FROM ${plain}`);

        await adminOnly('moin_dispatcher');
        expect(await membership(), 'ADMIN-only grant to one of our runtime roles').toBe(true);
        await ddl(`REVOKE ${probe} FROM moin_dispatcher`);

        await ddl(`GRANT ${probe} TO ${creator} WITH ADMIN TRUE, INHERIT TRUE, SET FALSE`);
        expect(await membership(), 'a member that inherits').toBe(true);
        await ddl(`REVOKE ${probe} FROM ${creator}`);
        await ddl(`GRANT ${probe} TO ${creator} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
        expect(await membership(), 'a member that can SET ROLE').toBe(true);
        await ddl(`REVOKE ${probe} FROM ${creator}`);
        await ddl(`GRANT ${creator} TO ${probe} WITH INHERIT FALSE, SET FALSE`);
        expect(await membership(), 'a member of another role').toBe(true);
      } finally {
        await pool.end();
        await ddl(
          `REVOKE ${probe} FROM moin_dispatcher; REVOKE ${creator} FROM moin_reporting; DROP ROLE IF EXISTS ${probe}; DROP ROLE IF EXISTS ${creator}; DROP ROLE IF EXISTS ${plain}`,
        );
      }
    },
  );

  evidenceTest(
    "rejects a runtime role that can reach the identity role or the functions' owner",
    async () => {
      // Throwaway intermediary: a runtime role made a SET-only member of the owner could SET ROLE to
      // it and execute the six, which has_function_privilege alone would not show.
      const owner = (
        await database
          .fixturePool()
          .query<{ owner: string }>(
            "select pg_get_userbyid(proowner)::text as owner from pg_proc where proname = 'begin_session'",
          )
      ).rows[0]?.owner;
      expect(owner).toBeDefined();
      await ddl(`GRANT ${owner ?? ''} TO moin_reporting WITH INHERIT FALSE, SET TRUE`);
      try {
        expect(rulesFor(await findings(), owner ?? '')).toContain('session-role-reachable');
      } finally {
        await ddl(`REVOKE ${owner ?? ''} FROM moin_reporting`);
      }
    },
  );
  /* eslint-enable no-restricted-syntax */

  it('reports nothing about the identity boundary once the fixtures are revoked', async () => {
    // Scoped to its own subjects: earlier cases in this file leave their own fixtures behind.
    const subjects = new Set([
      'moin_identity',
      'app.begin_session',
      'app.begin_sign_in',
      'app.consume_sign_in',
      'app.resolve_session',
      'app.revoke_session',
      'app.rotate_session',
    ]);
    expect((await findings()).filter((finding) => subjects.has(finding.subject))).toStrictEqual([]);
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
