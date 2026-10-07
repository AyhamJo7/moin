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

  evidenceTest('an old-host readiness query passes against the migrated schema', async () => {
    // Defect 3: the pre-0015 probe (48a551d) counts executable DEFINERs with total = 7
    // and checks 6-arg begin_session and 4-arg rotate_session. The INVOKER shims must
    // satisfy has_function_privilege and not inflate total = 7.
    const idPool = database.identityPool();
    const oldProbe = await idPool.query<{ ok: boolean }>(
      `select session_user = 'moin_identity' and current_user = 'moin_identity'
         and not (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication)
         and not exists (select 1 from pg_auth_members m where m.member = r.oid)
         and not has_function_privilege('moin_app', 'app.begin_sign_in(bytea, bytea, bytea, bytea, text, text)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.consume_sign_in(bytea, bytea)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.begin_session(text, bytea, uuid, bytea, text, bytea)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.rotate_session(bytea, bytea, uuid, text)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.resolve_session(bytea)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.resolve_request_context(bytea)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.revoke_session(bytea)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.revoke_session(bytea, text)', 'EXECUTE')
         and not has_function_privilege('moin_app', 'app.revoke_session(uuid, text)', 'EXECUTE')
         and d.functions @> d.expected and d.functions <@ d.expected and d.total = 7
         as ok
        from pg_roles r,
             lateral (
               select coalesce(array_agg(n.nspname || '.' || p.proname), '{}') as functions,
                      count(*) as total,
                      array['app.begin_sign_in', 'app.consume_sign_in', 'app.begin_session',
                            'app.rotate_session', 'app.resolve_session', 'app.revoke_session',
                            'app.resolve_request_context'] as expected
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where p.prosecdef and has_function_privilege(p.oid, 'EXECUTE')
             ) d
       where r.rolname = current_user`,
    );
    expect(oldProbe.rows[0]?.ok).toBe(true);
  });

  evidenceTest(
    'older hosts can execute 6-arg begin_session and 4-arg rotate_session shims',
    async () => {
      const idPool = database.identityPool();
      const resBegin = await idPool.query(
        'select session_id from app.begin_session($1::text, $2::bytea, $3::uuid, $4::bytea, $5::text, $6::bytea)',
        [
          'nonexistent-sub',
          Buffer.alloc(32, 1),
          '00000000-0000-0000-0000-000000000001',
          Buffer.from('test'),
          'test-k',
          null,
        ],
      );
      expect(resBegin.rowCount).toBe(0);

      const resRotate = await idPool.query(
        'select session_id from app.rotate_session($1::bytea, $2::bytea, $3::uuid, $4::text)',
        [
          Buffer.alloc(32, 2),
          Buffer.alloc(32, 3),
          '00000000-0000-0000-0000-000000000002',
          'step_up',
        ],
      );
      expect(resRotate.rowCount).toBe(0);
    },
  );

  evidenceTest('is not ready once moin_app can execute a session function', async () => {
    const admin = database.fixturePool();
    // Every one of the session functions, both overloads and shims: readiness must
    // shut out moin_app from the whole session surface, not just one probe function.
    const grants = [
      'grant execute on function app.begin_sign_in(bytea, bytea, bytea, bytea, text, text) to moin_app',
      'grant execute on function app.begin_sign_in(bytea, bytea, bytea, bytea, text, text, uuid) to moin_app',
      'grant execute on function app.consume_sign_in(bytea, bytea) to moin_app',
      'grant execute on function app.begin_session(text, bytea, uuid, bytea, text, bytea) to moin_app',
      'grant execute on function app.begin_session(text, bytea, uuid, bytea, text, bytea, timestamptz) to moin_app',
      'grant execute on function app.rotate_session(bytea, bytea, uuid, text) to moin_app',
      'grant execute on function app.rotate_session(bytea, bytea, uuid, text, timestamptz) to moin_app',
      'grant execute on function app.resolve_session(bytea) to moin_app',
      'grant execute on function app.revoke_session(bytea) to moin_app',
      'grant execute on function app.revoke_session(bytea, text) to moin_app',
      'grant execute on function app.revoke_session(uuid, text) to moin_app',
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
