/** P06.06 / ADR-0003: the api refuses an identity pool that is not the restricted moin_identity. */
import { createPool } from '@moin/db/pool';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../config/env.ts';
import { createIdentityPool, verifyIdentityPool } from './identity-pool.module.ts';
import { loadConfig } from '../../config/env.ts';

const PROVISION_TENANT =
  'app.provision_tenant(uuid, citext, text, text, text, text, text, boolean, text)';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase('identity-pool');
});

afterAll(async () => {
  await database.drop();
});

/** Verifies a fresh pool on `url`; the pool is always closed, by the check or here. */
async function verify(url: string): Promise<unknown> {
  const pool = createPool({ connectionString: url, max: 1 });
  try {
    await verifyIdentityPool(pool);
    await pool.end();
    return undefined;
  } catch (error) {
    expect(pool.ended).toBe(true);
    return error;
  }
}

describe('verifying the identity pool before the store exists', () => {
  it('accepts moin_identity as provisioned', async () => {
    expect(await verify(database.identityUrl ?? '')).toBeUndefined();
  });

  evidenceTest('refuses a credential for another role, without echoing it', async () => {
    for (const url of [database.appUrl, database.migrationUrl]) {
      const error = await verify(url);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain(new URL(url).password);
      expect(String(error)).not.toContain(new URL(url).username);
    }
  });

  evidenceTest('refuses moin_identity once it can execute a seventh definer function', async () => {
    const admin = database.fixturePool();
    // eslint-disable-next-line no-restricted-syntax -- the signature is a module constant.
    await admin.query(`grant execute on function ${PROVISION_TENANT} to moin_identity`);
    try {
      expect(await verify(database.identityUrl ?? '')).toBeInstanceOf(ConfigurationError);
    } finally {
      // eslint-disable-next-line no-restricted-syntax -- the signature is a module constant.
      await admin.query(`revoke execute on function ${PROVISION_TENANT} from moin_identity`);
    }
  });

  evidenceTest('refuses moin_identity once it loses a session function', async () => {
    const admin = database.fixturePool();
    // The 1-arg form is an INVOKER shim; revoking it changes no DEFINER name. Revoke both
    // same-name DEFINER overloads: the name drops out of moin_identity's DEFINER set entirely.
    await admin.query(
      'revoke execute on function app.revoke_session(bytea, text) from moin_identity',
    );
    await admin.query(
      'revoke execute on function app.revoke_session(uuid, text) from moin_identity',
    );
    try {
      expect(await verify(database.identityUrl ?? '')).toBeInstanceOf(ConfigurationError);
    } finally {
      await admin.query(
        'grant execute on function app.revoke_session(bytea, text) to moin_identity',
      );
      await admin.query(
        'grant execute on function app.revoke_session(uuid, text) to moin_identity',
      );
    }
  });

  evidenceTest('the new revocation overloads stay shut to moin_app', async () => {
    // P06.06.05: `revoke_session(bytea, text)` (sign-out-others) and `revoke_session(uuid,
    // text)` (reset) grant EXECUTE to moin_identity only. The catalog check's session
    // boundary pins that; this is the direct negative control. (The production probe names
    // the 0015 surface so old hosts keep verifying during the rollout.)
    const admin = database.fixturePool();
    for (const sig of ['app.revoke_session(bytea, text)', 'app.revoke_session(uuid, text)']) {
      const before = await admin.query<{ id: boolean; app: boolean }>(
        `select has_function_privilege('moin_identity', $1, 'EXECUTE') as id,
                has_function_privilege('moin_app', $1, 'EXECUTE') as app`,
        [sig],
      );
      expect(before.rows[0]).toMatchObject({ id: true, app: false });
    }
  });
});

describe('the identity store factory', () => {
  evidenceTest('refuses when identity pool connects to DATABASE_URL as moin_app', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SERVER_ROLE: 'api',
      APP_ORIGIN: 'http://localhost:3000',
      LOG_LEVEL: 'info',
      DATABASE_URL: database.appUrl,
      IDENTITY_DATABASE_URL: database.identityUrl,
    });
    const pool = createIdentityPool(config);
    expect(pool).not.toBeNull();
    if (pool === null) return;
    try {
      await expect(verifyIdentityPool(pool)).resolves.toBeUndefined();
    } finally {
      if (!pool.ended) await pool.end();
    }
  });
});
