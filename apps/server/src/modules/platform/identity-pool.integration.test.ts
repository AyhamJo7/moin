/** P06.06 / ADR-0003: the api refuses an identity pool that is not the restricted moin_identity. */
import { createPool } from '@moin/db/pool';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../config/env.ts';
import { verifyIdentityPool } from './identity-pool.module.ts';

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
    await admin.query(
      'revoke execute on function app.revoke_session(bytea, timestamptz) from moin_identity',
    );
    try {
      expect(await verify(database.identityUrl ?? '')).toBeInstanceOf(ConfigurationError);
    } finally {
      await admin.query(
        'grant execute on function app.revoke_session(bytea, timestamptz) to moin_identity',
      );
    }
  });
});
