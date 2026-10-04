/** P06.06 / ADR-0003: the identity pool is ready only as moin_identity, with moin_app shut out. */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTITY_POOL_ASSERTION, postgresReadiness } from './readiness.ts';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase('readiness-identity');
});

afterAll(async () => {
  await database.drop();
});

async function probe(connectionString: string) {
  const check = postgresReadiness({
    connectionString,
    name: 'postgres-identity',
    assertion: IDENTITY_POOL_ASSERTION,
    cacheTtlMs: 0,
  });
  try {
    return await check.check();
  } finally {
    await check.close();
  }
}

describe('the identity pool readiness probe', () => {
  it('is ready as moin_identity', async () => {
    const result = await probe(database.identityUrl ?? '');
    expect(result).toMatchObject({ name: 'postgres-identity', ready: true });
  });

  evidenceTest('is not ready when the credential names another role', async () => {
    for (const url of [database.appUrl, database.migrationUrl]) {
      const result = await probe(url);
      expect(result).toMatchObject({ ready: false, reason: 'role_mismatch' });
    }
  });

  evidenceTest('is not ready once moin_app can execute a session function', async () => {
    const admin = database.fixturePool();
    await admin.query('grant execute on function app.resolve_session(bytea) to moin_app');
    try {
      expect(await probe(database.identityUrl ?? '')).toMatchObject({
        ready: false,
        reason: 'role_mismatch',
      });
    } finally {
      await admin.query('revoke execute on function app.resolve_session(bytea) from moin_app');
    }
  });
});
