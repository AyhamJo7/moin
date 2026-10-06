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
    // Every one of the session functions, both begin_sign_in arities: readiness must
    // shut out moin_app from the whole session surface, not just one probe function.
    const grants = [
      'grant execute on function app.begin_sign_in(bytea, bytea, bytea, bytea, text, text) to moin_app',
      'grant execute on function app.begin_sign_in(bytea, bytea, bytea, bytea, text, text, uuid) to moin_app',
      'grant execute on function app.consume_sign_in(bytea, bytea) to moin_app',
      'grant execute on function app.begin_session(text, bytea, uuid, bytea, text, bytea) to moin_app',
      'grant execute on function app.rotate_session(bytea, bytea, uuid, text) to moin_app',
      'grant execute on function app.resolve_session(bytea) to moin_app',
      'grant execute on function app.revoke_session(bytea) to moin_app',
    ];
    const revokes = grants.map((grant) =>
      grant.replace('grant execute', 'revoke execute').replace(' to moin_app', ' from moin_app'),
    );
    for (const [index, grant] of grants.entries()) {
      await admin.query(grant);
      try {
        expect(await probe(database.identityUrl ?? '')).toMatchObject({
          ready: false,
          reason: 'role_mismatch',
        });
      } finally {
        await admin.query(revokes[index] ?? '');
      }
    }
  });

  evidenceTest('is not ready when a foreign-schema definer is executable', async () => {
    // The executable set spans every schema: a grantable DEFINER smuggled into another
    // schema must stop the rollout even though the CI catalog would also flag it.
    const admin = database.fixturePool();
    await admin.query(
      'create function public.step_up_backdoor() returns void language plpgsql security definer as $$ begin end $$',
    );
    await admin.query('grant execute on function public.step_up_backdoor() to moin_identity');
    try {
      expect(await probe(database.identityUrl ?? '')).toMatchObject({
        ready: false,
        reason: 'role_mismatch',
      });
    } finally {
      await admin.query('drop function public.step_up_backdoor()');
    }
  });
});
