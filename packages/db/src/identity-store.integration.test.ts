/**
 * P06.06.01/.02: the sign-in and session functions, exercised as the real NOBYPASSRLS runtime role.
 *
 * Fixtures (users, direct row reads) go through the migration connection. Every behaviour under test
 * goes through `moin_identity`, the api-only role that alone may execute the six functions and that
 * touches none of the tables; `moin_app` — the voice and worker role — is shown to reach none of it.
 *
 * PostgreSQL's own `clock_timestamp()` is the sole authoritative clock for authorization and expiry;
 * caller-supplied time is never accepted.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createPool, type Pool } from './pool.ts';
import { createIdentityStore, type IdentityStore } from './identity-store.ts';

const HOUR_MS = 3_600_000;
const IDLE_MS = 12 * HOUR_MS;
const ABSOLUTE_MS = 7 * 24 * HOUR_MS;

let database: TestDatabase;
/** `moin_app`: tenant work in api, voice and worker. It must reach none of this. */
let app: Pool;
/** `moin_identity`: api's second pool, and the only role that may execute the session functions. */
let identity: Pool;
let admin: Pool;
let store: IdentityStore;

const hash = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();
const sealed = (): Buffer => randomBytes(64);

async function user(
  status: 'active' | 'disabled' = 'active',
): Promise<{ id: string; sub: string }> {
  const id = randomUUID();
  const sub = randomUUID();
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    sub,
    `${sub.slice(0, 8)}@example.test`,
    status,
  ]);
  return { id, sub };
}

async function signIn(subject: string, replacedHash?: Buffer) {
  const tokenHash = hash();
  const granted = await store.beginSession({
    subject,
    tokenHash,
    sessionId: randomUUID(),
    providerTokensSealed: sealed(),
    keyId: 'test-v1',
    replacedHash,
  });
  return { tokenHash, granted };
}

function transaction() {
  return {
    stateHash: hash(),
    bindingHash: hash(),
    nonceHash: hash(),
    verifierSealed: sealed(),
    keyId: 'test-v1',
    returnTo: '/today',
  };
}

async function insertAbsoluteExpiredSession(
  userId: string,
  tokenHash: Buffer,
  expiredAgoInterval = "interval '1 millisecond'",
) {
  const id = randomUUID();
  await admin.query(
    `with t as (select clock_timestamp() - interval '7 days' - ${expiredAgoInterval} as created)
     insert into sessions (
       token_hash, id, family_id, user_id, rotation_reason,
       created_at, last_seen_at, idle_expires_at, absolute_expires_at,
       provider_tokens_sealed, provider_tokens_key_id
     ) select
       $1, $2, $2, $3, 'login',
       t.created,
       t.created,
       t.created + interval '12 hours',
       t.created + interval '7 days',
       $4, 'test-v1'
     from t`,
    [tokenHash, id, userId, sealed()],
  );
  return { id, tokenHash };
}

beforeAll(async () => {
  database = await createTestDatabase('identity');
  app = database.pool();
  identity = database.identityPool();
  admin = createPool({ connectionString: database.migrationUrl, max: 4 });
  store = createIdentityStore(identity);
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

const SESSION_FUNCTIONS = [
  'begin_session',
  'begin_sign_in',
  'consume_sign_in',
  'resolve_session',
  'revoke_session',
  'rotate_session',
] as const;

/** Every call shape a holder of a role could use to mint, read or change a session. */
function directCalls(subject: string, tokenHash: Buffer): [string, string, unknown[]][] {
  return [
    [
      'begin_session',
      'select * from app.begin_session($1::text, $2::bytea, $3::uuid, $4::bytea, $5::text, null)',
      [subject, hash(), randomUUID(), sealed(), 'test-v1'],
    ],
    [
      'begin_sign_in',
      'select app.begin_sign_in($1::bytea, $2::bytea, $3::bytea, $4::bytea, $5::text, $6::text)',
      [hash(), hash(), hash(), sealed(), 'test-v1', '/'],
    ],
    [
      'consume_sign_in',
      'select * from app.consume_sign_in($1::bytea, $2::bytea)',
      [hash(), hash()],
    ],
    ['resolve_session', 'select * from app.resolve_session($1::bytea)', [tokenHash]],
    [
      'rotate_session',
      'select * from app.rotate_session($1::bytea, $2::bytea, $3::uuid, $4::text)',
      [tokenHash, hash(), randomUUID(), 'step_up'],
    ],
    ['revoke_session', 'select app.revoke_session($1::bytea)', [tokenHash]],
  ];
}

describe('moin_app — the voice and worker role — and sessions', () => {
  evidenceTest(
    'cannot mint, resolve, rotate or revoke a session by calling the functions',
    async () => {
      const person = await user();
      const live = await signIn(person.sub);
      const before = await admin.query<{ n: string }>('select count(*)::text as n from sessions');
      for (const [name, sql, params] of directCalls(person.sub, live.tokenHash)) {
        await expect(app.query(sql, params), name).rejects.toMatchObject({ code: '42501' });
      }
      const after = await admin.query<{ n: string }>('select count(*)::text as n from sessions');
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
      const row = await admin.query<{ revoked_at: Date | null }>(
        'select revoked_at from sessions where token_hash = $1',
        [live.tokenHash],
      );
      expect(row.rows[0]?.revoked_at).toBeNull();
    },
  );

  evidenceTest('has no privilege on users, sign-in transactions or sessions', async () => {
    for (const statement of [
      'select * from users',
      'delete from users',
      'update users set id = id',
      'select * from auth_transactions',
      'delete from auth_transactions',
      'update auth_transactions set state_hash = state_hash',
      'select * from sessions',
      'delete from sessions',
      'update sessions set id = id',
    ]) {
      await expect(app.query(statement), statement).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      app.query(
        "insert into sessions (token_hash, id, family_id, user_id, rotation_reason, created_at, last_seen_at, idle_expires_at, absolute_expires_at, provider_tokens_sealed, provider_tokens_key_id) values ($1, $2, $2, $3, 'login', now(), now(), now(), now(), $4, 'k')",
        [hash(), randomUUID(), randomUUID(), sealed()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('moin_identity — the api-only session role', () => {
  evidenceTest('has no table privilege anywhere, tenant table or session table', async () => {
    for (const statement of [
      'select * from users',
      'select * from sessions',
      'select * from auth_transactions',
      'update sessions set revoked_at = now()',
      'delete from sessions',
      'select * from organisations',
      'select * from locations',
      'select * from audit_events',
      'select * from provisioning_requests',
    ]) {
      await expect(identity.query(statement), statement).rejects.toMatchObject({ code: '42501' });
    }
  });

  evidenceTest('cannot execute any other privileged function', async () => {
    for (const [name, sql] of [
      [
        'provision_tenant',
        "select app.provision_tenant(gen_random_uuid(), 'x', 'x', 'x', 'x', 'x', 'x', false, 'Europe/Berlin')",
      ],
      ['claim_audit_chains', 'select * from app.claim_audit_chains(1, 0, 0)'],
      ['audit_chain_high_water', 'select app.audit_chain_high_water()'],
      ['apply_tenant_rls', "select app.apply_tenant_rls('sessions'::regclass)"],
    ] as const) {
      await expect(identity.query(sql), name).rejects.toMatchObject({ code: '42501' });
    }
  });

  evidenceTest('is unprivileged, a member of nothing, and owns nothing', async () => {
    const role = await admin.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      rolcanlogin: boolean;
      memberships: number;
      owned: number;
    }>(
      `select r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolcanlogin,
              (select count(*) from pg_auth_members m where m.member = r.oid or m.roleid = r.oid)::int as memberships,
              ((select count(*) from pg_class c where c.relowner = r.oid)
               + (select count(*) from pg_proc p where p.proowner = r.oid)
               + (select count(*) from pg_namespace n where n.nspowner = r.oid))::int as owned
       from pg_roles r where r.rolname = 'moin_identity'`,
    );
    expect(role.rows[0]).toStrictEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolcanlogin: true,
      memberships: 0,
      owned: 0,
    });
    // eslint-disable-next-line no-restricted-syntax -- negative probe: the role must be unable to assume another.
    await expect(identity.query('set role moin_app')).rejects.toMatchObject({ code: '42501' });
    await expect(identity.query('create table probe (x int)')).rejects.toMatchObject({
      code: '42501',
    });
    // TEMPORARY is a PUBLIC default on every database; it is moved off PUBLIC at provisioning.
    await expect(identity.query('create temporary table probe (x int)')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      identity.query("create function pg_temp.probe() returns int language sql as 'select 1'"),
    ).rejects.toMatchObject({ code: '42501' });
    // Large objects need only EXECUTE on the creators, which PUBLIC held; provisioning revokes it.
    for (const sql of [
      "select lo_from_bytea(0, '\\x00'::bytea)",
      'select lo_create(0)',
      'select lo_creat(-1)',
    ]) {
      await expect(identity.query(sql), sql).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('who may execute the session functions', () => {
  evidenceTest('moin_identity alone, among every runtime role', async () => {
    const roles = [
      'moin_identity',
      'moin_app',
      'moin_provisioner',
      'moin_dispatcher',
      'moin_support_ro',
      'moin_reporting',
    ];
    const result = await admin.query<{ role: string; fn: string; allowed: boolean }>(
      `select r.rolname::text as role, p.proname::text as fn,
              has_function_privilege(r.rolname, p.oid, 'EXECUTE') as allowed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace, pg_roles r
       where n.nspname = 'app' and p.proname = any($1) and r.rolname = any($2)`,
      [[...SESSION_FUNCTIONS, 'reject_session_rewrite'], roles],
    );
    const matrix: Record<string, string[]> = {};
    for (const row of result.rows) {
      if (row.allowed) (matrix[row.role] ??= []).push(row.fn);
    }
    for (const role of Object.keys(matrix)) matrix[role]?.sort();
    expect(matrix).toStrictEqual({ moin_identity: [...SESSION_FUNCTIONS] });
  });
});

describe('a sign-in transaction', () => {
  evidenceTest('is consumed exactly once', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    const first = await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash);
    expect(first).toStrictEqual({
      nonceHash: tx.nonceHash,
      verifierSealed: tx.verifierSealed,
      keyId: 'test-v1',
      returnTo: '/today',
    });
    expect(await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash)).toBeUndefined();
  });

  evidenceTest('is refused for an unknown state', async () => {
    expect(await store.consumeAuthTransaction(hash(), hash())).toBeUndefined();
  });

  evidenceTest('is refused and burnt when presented from another browser', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    expect(await store.consumeAuthTransaction(tx.stateHash, hash())).toBeUndefined();
    // The right browser cannot use it afterwards either: a probe destroys what it probes.
    expect(await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash)).toBeUndefined();
  });

  evidenceTest('expires exactly 10 minutes after it starts', async () => {
    const live = transaction();
    await store.beginAuthTransaction(live);
    expect(await store.consumeAuthTransaction(live.stateHash, live.bindingHash)).toBeDefined();

    const stale = transaction();
    await store.beginAuthTransaction(stale);
    await admin.query(
      `with t as (select clock_timestamp() - interval '11 minutes' as c)
       update auth_transactions set
         created_at = t.c,
         expires_at = t.c + interval '10 minutes'
       from t
       where state_hash = $1`,
      [stale.stateHash],
    );
    expect(await store.consumeAuthTransaction(stale.stateHash, stale.bindingHash)).toBeUndefined();
  });

  concurrentDuplicate();

  it('removes expired transactions when the next sign-in starts', async () => {
    const stale = transaction();
    await store.beginAuthTransaction(stale);
    await admin.query(
      `with t as (select clock_timestamp() - interval '11 minutes' as c)
       update auth_transactions set
         created_at = t.c,
         expires_at = t.c + interval '10 minutes'
       from t
       where state_hash = $1`,
      [stale.stateHash],
    );
    await store.beginAuthTransaction(transaction());
    const left = await admin.query('select 1 from auth_transactions where state_hash = $1', [
      stale.stateHash,
    ]);
    expect(left.rowCount).toBe(0);
  });
});

function concurrentDuplicate(): void {
  evidenceTest('cannot be consumed twice by concurrent callbacks', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => store.consumeAuthTransaction(tx.stateHash, tx.bindingHash)),
    );
    expect(attempts.filter((attempt) => attempt !== undefined)).toHaveLength(1);
  });
}

describe('issuing a session', () => {
  evidenceTest('refuses a subject with no user row and creates nothing', async () => {
    const { tokenHash, granted } = await signIn(randomUUID());
    expect(granted).toBeUndefined();
    const rows = await admin.query('select 1 from sessions where token_hash = $1', [tokenHash]);
    expect(rows.rowCount).toBe(0);
  });

  evidenceTest('refuses a disabled user', async () => {
    const disabled = await user('disabled');
    expect((await signIn(disabled.sub)).granted).toBeUndefined();
  });

  evidenceTest('a disable racing sign-in mints no live session', async () => {
    const person = await user();
    // Hold the user row the way begin_session's FOR SHARE does, so the disable below provably
    // waits on this sign-in rather than racing it by luck.
    const gate = await admin.connect();
    try {
      await gate.query('begin');
      await gate.query('select 1 from users where id = $1 for update', [person.id]);

      const pending = store.beginSession({
        subject: person.sub,
        tokenHash: hash(),
        sessionId: randomUUID(),
        providerTokensSealed: sealed(),
        keyId: 'test-v1',
      });

      const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
      let waiting = '0';
      while (waiting !== '1' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
        const result = await admin.query<{ n: string }>(
          "select count(*)::text as n from pg_stat_activity where wait_event_type = 'Lock' and datname = $1",
          [database.name],
        );
        waiting = result.rows[0]?.n ?? '0';
      }
      expect(waiting, 'sign-in waits on the user lock').toBe('1');

      await gate.query("update users set status = 'disabled' where id = $1", [person.id]);
      await gate.query('commit');

      expect(await pending).toBeUndefined();
    } finally {
      gate.release();
    }
  });

  evidenceTest('stores the token digest and a 7-day absolute, 12-hour idle lifetime', async () => {
    const person = await user();
    const { tokenHash, granted } = await signIn(person.sub);
    expect(granted).toMatchObject({ userId: person.id });
    const row = await admin.query<{
      created_at: Date;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      rotation_reason: string;
    }>(
      'select created_at, idle_expires_at, absolute_expires_at, rotation_reason from sessions where token_hash = $1',
      [tokenHash],
    );
    const s = row.rows[0];
    expect(s).toBeDefined();
    if (s === undefined) throw new Error('session row not found');
    expect(s.rotation_reason).toBe('login');
    expect(s.idle_expires_at.getTime() - s.created_at.getTime()).toBeCloseTo(IDLE_MS, -3);
    expect(s.absolute_expires_at.getTime() - s.created_at.getTime()).toBeCloseTo(ABSOLUTE_MS, -3);
  });

  evidenceTest('revokes the session the browser already held', async () => {
    const person = await user();
    const previous = await signIn(person.sub);
    const next = await signIn(person.sub, previous.tokenHash);
    expect(next.granted).toBeDefined();
    expect(await store.resolveSession(previous.tokenHash)).toBeUndefined();
    expect(await store.resolveSession(next.tokenHash)).toBeDefined();
  });
});

describe('a session over time', () => {
  evidenceTest('is rejected after its idle timeout', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    expect(await store.resolveSession(tokenHash)).toBeDefined();

    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '1 second' where token_hash = $1",
      [tokenHash],
    );
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });

  evidenceTest('is rejected after its absolute timeout', async () => {
    const person = await user();
    const tokenHash = hash();
    await insertAbsoluteExpiredSession(person.id, tokenHash, "interval '1 second'");
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });

  evidenceTest('never lets idle expiry pass the absolute expiry', async () => {
    const person = await user();
    const tokenHash = hash();
    const id = randomUUID();
    // Created 6 days and 18 hours ago, so absolute expiry is in 6 hours (< 12 hours)
    await admin.query(
      `with t as (select clock_timestamp() - interval '6 days' - interval '18 hours' as created)
       insert into sessions (
         token_hash, id, family_id, user_id, rotation_reason,
         created_at, last_seen_at, idle_expires_at, absolute_expires_at,
         provider_tokens_sealed, provider_tokens_key_id
       ) select
         $1, $2, $2, $3, 'login',
         t.created,
         t.created,
         t.created + interval '12 hours',
         t.created + interval '7 days',
         $4, 'test-v1'
       from t`,
      [tokenHash, id, person.id, sealed()],
    );
    const resolved = await store.resolveSession(tokenHash);
    expect(resolved?.idleExpiresAt).toStrictEqual(resolved?.absoluteExpiresAt);
  });

  it('records a burst of activity as one write, never moving the idle expiry later', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const first = await store.resolveSession(tokenHash);
    const burst = await store.resolveSession(tokenHash);
    expect(burst?.idleExpiresAt).toStrictEqual(first?.idleExpiresAt);
  });

  evidenceTest('is rejected after revocation and stays revoked', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    expect(await store.revokeSession(tokenHash)).toBe(true);
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
    expect(await store.revokeSession(tokenHash)).toBe(false);
  });

  it('stops resolving once its user is disabled', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await admin.query("update users set status = 'disabled' where id = $1", [person.id]);
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });
});

describe('rotation', () => {
  evidenceTest('issues a successor and leaves the predecessor unusable', async () => {
    const person = await user();
    const { tokenHash, granted } = await signIn(person.sub);
    const successor = hash();
    const rotated = await store.rotateSession(tokenHash, successor, randomUUID(), 'step_up');
    expect(rotated).toMatchObject({
      userId: person.id,
      absoluteExpiresAt: granted?.absoluteExpiresAt,
    });
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
    expect(await store.resolveSession(successor)).toBeDefined();

    const lineage = await admin.query<{ family_id: string; rotated_from: string | null }>(
      'select family_id, rotated_from from sessions where token_hash = $1',
      [successor],
    );
    expect(lineage.rows[0]).toStrictEqual({
      family_id: granted?.sessionId,
      rotated_from: granted?.sessionId,
    });
  });

  evidenceTest('cannot extend the 7-day absolute lifetime', async () => {
    const person = await user();
    const { tokenHash, granted } = await signIn(person.sub);
    const successor = hash();
    const rotated = await store.rotateSession(
      tokenHash,
      successor,
      randomUUID(),
      'privilege_change',
    );
    expect(rotated?.absoluteExpiresAt).toStrictEqual(granted?.absoluteExpiresAt);
  });

  evidenceTest('leaves exactly one successor when rotations race', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const successors = Array.from({ length: 8 }, () => hash());
    const outcomes = await Promise.allSettled(
      successors.map((successor) =>
        store.rotateSession(tokenHash, successor, randomUUID(), 'step_up'),
      ),
    );
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const granted = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value !== undefined,
    );
    expect(granted).toHaveLength(1);
    const live = await Promise.all(successors.map((s) => store.resolveSession(s)));
    expect(live.filter((session) => session !== undefined)).toHaveLength(1);
  });

  evidenceTest('refuses a revoked or expired predecessor', async () => {
    const person = await user();
    const revoked = await signIn(person.sub);
    await store.revokeSession(revoked.tokenHash);
    expect(
      await store.rotateSession(revoked.tokenHash, hash(), randomUUID(), 'step_up'),
    ).toBeUndefined();

    const idle = await signIn(person.sub);
    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '1 second' where token_hash = $1",
      [idle.tokenHash],
    );
    expect(
      await store.rotateSession(idle.tokenHash, hash(), randomUUID(), 'step_up'),
    ).toBeUndefined();
  });

  it('refuses login as a rotation reason', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await expect(
      identity.query('select * from app.rotate_session($1, $2, $3, $4)', [
        tokenHash,
        hash(),
        randomUUID(),
        'login',
      ]),
    ).rejects.toMatchObject({ code: '22023' });
  });

  evidenceTest('a disable racing rotation extends nothing', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const successor = hash();

    const a = await admin.connect();
    const b = await identity.connect();
    try {
      // Hold the user row the way rotate_session's FOR SHARE OF u does, so the disable below
      // provably waits on this rotation rather than racing it by luck.
      await a.query('begin');
      await a.query('select 1 from users where id = $1 for update', [person.id]);

      await b.query('begin');
      const pending = b.query('select * from app.rotate_session($1, $2, $3, $4)', [
        tokenHash,
        successor,
        randomUUID(),
        'step_up',
      ]);

      const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
      let waiting = '0';
      while (waiting !== '1' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
        const result = await admin.query<{ n: string }>(
          "select count(*)::text as n from pg_stat_activity where wait_event_type = 'Lock' and datname = $1",
          [database.name],
        );
        waiting = result.rows[0]?.n ?? '0';
      }
      expect(waiting, 'rotation waits on the user lock').toBe('1');

      await a.query("update users set status = 'disabled' where id = $1", [person.id]);
      await a.query('commit');

      const secondResult = await pending;
      await b.query('commit');

      expect(secondResult.rowCount, 'rotation after disable returned 0 rows').toBe(0);
      expect(await store.resolveSession(successor)).toBeUndefined();
    } finally {
      a.release();
      b.release();
    }
  });
});

const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_DEADLINE_MS = 5_000;

describe('two callers holding the same row', () => {
  /** Two connections, so the second statement provably waits on the first one's row lock. */
  async function interleaved<T1, T2>(
    first: (client: PoolClient) => Promise<T1>,
    second: (client: PoolClient) => Promise<T2>,
  ): Promise<{ first: T1; second: T2 }> {
    const a = await identity.connect();
    const b = await identity.connect();
    try {
      await a.query('begin');
      const firstResult = await first(a);
      await b.query('begin');
      const pending = second(b);
      const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
      let waiting = '0';
      while (waiting !== '1' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
        const result = await admin.query<{ n: string }>(
          "select count(*)::text as n from pg_stat_activity where wait_event_type = 'Lock' and datname = $1",
          [database.name],
        );
        waiting = result.rows[0]?.n ?? '0';
      }
      expect(waiting, 'second caller waits on the lock').toBe('1');
      await a.query('commit');
      const secondResult = await pending;
      await b.query('commit');
      return { first: firstResult, second: secondResult };
    } finally {
      a.release();
      b.release();
    }
  }

  const beginSessionSql =
    'select * from app.begin_session($1::text, $2::bytea, $3::uuid, $4::bytea, $5::text, $6::bytea)';

  evidenceTest(
    'a sign-in waiting behind a rotation of the session it supersedes revokes the successor too',
    async () => {
      const person = await user();
      const presented = await signIn(person.sub);
      const successor = hash();
      const next = hash();
      await interleaved(
        (client) =>
          client.query('select * from app.rotate_session($1, $2, $3, $4)', [
            presented.tokenHash,
            successor,
            randomUUID(),
            'step_up',
          ]),
        (client) =>
          client.query(beginSessionSql, [
            person.sub,
            next,
            randomUUID(),
            sealed(),
            'test-v1',
            presented.tokenHash,
          ]),
      );
      expect(await store.resolveSession(successor), 'rotated successor').toBeUndefined();
      expect(await store.resolveSession(next), 'new sign-in').toBeDefined();
    },
  );

  evidenceTest(
    'a sign-in presenting a stale cookie supersedes a rotation in flight elsewhere in the family',
    async () => {
      const person = await user();
      const stale = await signIn(person.sub);
      const current = hash();
      await store.rotateSession(stale.tokenHash, current, randomUUID(), 'step_up');
      const inFlight = hash();
      const next = hash();
      await interleaved(
        (client) =>
          client.query('select * from app.rotate_session($1, $2, $3, $4)', [
            current,
            inFlight,
            randomUUID(),
            'privilege_change',
          ]),
        (client) =>
          client.query(beginSessionSql, [
            person.sub,
            next,
            randomUUID(),
            sealed(),
            'test-v1',
            stale.tokenHash,
          ]),
      );
      expect(await store.resolveSession(inFlight), 'rotated in flight').toBeUndefined();
      expect(await store.resolveSession(current)).toBeUndefined();
      expect(await store.resolveSession(next), 'new sign-in').toBeDefined();
    },
  );

  evidenceTest(
    'a rotation waiting behind a sign-in that supersedes its session inserts nothing',
    async () => {
      const person = await user();
      const presented = await signIn(person.sub);
      const successor = hash();
      const next = hash();
      const { second } = await interleaved(
        (client) =>
          client.query(beginSessionSql, [
            person.sub,
            next,
            randomUUID(),
            sealed(),
            'test-v1',
            presented.tokenHash,
          ]),
        (client) =>
          client.query('select * from app.rotate_session($1, $2, $3, $4)', [
            presented.tokenHash,
            successor,
            randomUUID(),
            'step_up',
          ]),
      );
      expect(second.rowCount).toBe(0);
      expect(await store.resolveSession(successor)).toBeUndefined();
      expect(await store.resolveSession(next)).toBeDefined();
    },
  );

  evidenceTest('a rotation waiting behind another rotation inserts nothing', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const rotate = (client: PoolClient) =>
      client.query('select * from app.rotate_session($1, $2, $3, $4)', [
        tokenHash,
        hash(),
        randomUUID(),
        'step_up',
      ]);
    const { first, second } = await interleaved(rotate, rotate);
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
  });

  evidenceTest('a callback waiting behind another callback consumes nothing', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    const consume = (client: PoolClient) =>
      client.query('select * from app.consume_sign_in($1, $2)', [tx.stateHash, tx.bindingHash]);
    const { first, second } = await interleaved(consume, consume);
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
  });

  evidenceTest('waiting on a lock until expiration rechecks after lock and fails', async () => {
    const person = await user();
    const presented = await signIn(person.sub);
    const successor = hash();

    const a = await admin.connect();
    const b = await identity.connect();
    try {
      await a.query('begin');
      await a.query('select 1 from public.sessions where id = $1 for update', [
        presented.granted?.sessionId,
      ]);

      await b.query('begin');
      const pending = b.query(
        'select * from app.rotate_session($1::bytea, $2::bytea, $3::uuid, $4::text)',
        [presented.tokenHash, successor, randomUUID(), 'step_up'],
      );

      const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
      let waiting = '0';
      while (waiting !== '1' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
        const result = await admin.query<{ n: string }>(
          "select count(*)::text as n from pg_stat_activity where wait_event_type = 'Lock' and datname = $1",
          [database.name],
        );
        waiting = result.rows[0]?.n ?? '0';
      }
      expect(waiting, 'second caller waits on the lock').toBe('1');

      // Hold the lock until the predecessor's idle expiry has provably passed on the database
      // clock, so a stale pre-lock reading of "now" is already expired when the blocked rotation
      // resumes: the post-lock recheck is the only thing that can refuse it. pg_sleep runs
      // server-side while a holds the family lock, so the sleep interval and the expiry it must
      // outlast share one clock.
      await a.query('select pg_sleep(1.5)');

      // While b is blocked on the family lock, a updates the predecessor session to be expired:
      await a.query(
        "update public.sessions set idle_expires_at = clock_timestamp() - interval '1 second' where token_hash = $1",
        [presented.tokenHash],
      );
      await a.query('commit');

      const secondResult = await pending;
      await b.query('commit');

      expect(secondResult.rowCount, 'rotation after lock recheck returned 0 rows').toBe(0);
      expect(await store.resolveSession(successor)).toBeUndefined();
    } finally {
      a.release();
      b.release();
    }
  });
});

describe('provider tokens at rest', () => {
  async function sealedOf(tokenHash: Buffer): Promise<Buffer | null | undefined> {
    const row = await admin.query<{ sealed: Buffer | null }>(
      'select provider_tokens_sealed as sealed from sessions where token_hash = $1',
      [tokenHash],
    );
    return row.rows[0]?.sealed;
  }

  evidenceTest('are erased when the session is revoked', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    expect(await sealedOf(tokenHash)).toBeInstanceOf(Buffer);
    await store.revokeSession(tokenHash);
    expect(await sealedOf(tokenHash)).toBeNull();

    const superseded = await signIn(person.sub);
    await signIn(person.sub, superseded.tokenHash);
    expect(await sealedOf(superseded.tokenHash)).toBeNull();
  });

  evidenceTest('move to the successor on rotation instead of being copied', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const before = await sealedOf(tokenHash);
    const successor = hash();
    await store.rotateSession(tokenHash, successor, randomUUID(), 'step_up');
    expect(await sealedOf(tokenHash)).toBeNull();
    expect(await sealedOf(successor)).toStrictEqual(before);
  });

  it('can be wiped but never replaced, even by the owner', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await expect(
      admin.query('update sessions set provider_tokens_sealed = $1 where token_hash = $2', [
        sealed(),
        tokenHash,
      ]),
    ).rejects.toMatchObject({ code: '23000' });
    await expect(
      admin.query(
        'update sessions set provider_tokens_sealed = null, provider_tokens_key_id = null where token_hash = $1',
        [tokenHash],
      ),
    ).rejects.toMatchObject({ code: '23000' });
  });
});

describe('temporal authorization and expiration (authoritative database clock)', () => {
  evidenceTest('idle expired 1 ms ago cannot resolve', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '1 millisecond' where token_hash = $1",
      [tokenHash],
    );
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });

  evidenceTest('idle expired 1 min ago cannot resolve', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '1 minute' where token_hash = $1",
      [tokenHash],
    );
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });

  evidenceTest('absolute expired 1 ms ago cannot resolve', async () => {
    const person = await user();
    const tokenHash = hash();
    await insertAbsoluteExpiredSession(person.id, tokenHash, "interval '1 millisecond'");
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });

  evidenceTest('absolute expired 1 min ago cannot resolve', async () => {
    const person = await user();
    const tokenHash = hash();
    await insertAbsoluteExpiredSession(person.id, tokenHash, "interval '1 minute'");
    expect(await store.resolveSession(tokenHash)).toBeUndefined();
  });

  evidenceTest('expired session cannot rotate', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await admin.query(
      "update sessions set idle_expires_at = clock_timestamp() - interval '10 seconds' where token_hash = $1",
      [tokenHash],
    );
    expect(await store.rotateSession(tokenHash, hash(), randomUUID(), 'step_up')).toBeUndefined();
  });

  evidenceTest('revoked session cannot rotate', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    expect(await store.revokeSession(tokenHash)).toBe(true);
    expect(await store.rotateSession(tokenHash, hash(), randomUUID(), 'step_up')).toBeUndefined();
  });

  evidenceTest('expired auth transaction cannot consume', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    await admin.query(
      `with t as (select clock_timestamp() - interval '11 minutes' as c)
       update auth_transactions set
         created_at = t.c,
         expires_at = t.c + interval '10 minutes'
       from t
       where state_hash = $1`,
      [tx.stateHash],
    );
    expect(await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash)).toBeUndefined();
  });

  evidenceTest(
    'activity on expired session cannot move last_seen_at or extend idle expiry',
    async () => {
      const person = await user();
      const { tokenHash } = await signIn(person.sub);
      await admin.query(
        "update sessions set idle_expires_at = clock_timestamp() - interval '10 seconds' where token_hash = $1",
        [tokenHash],
      );
      const before = await admin.query<{ last_seen_at: Date; idle_expires_at: Date }>(
        'select last_seen_at, idle_expires_at from sessions where token_hash = $1',
        [tokenHash],
      );
      expect(await store.resolveSession(tokenHash)).toBeUndefined();
      const after = await admin.query<{ last_seen_at: Date; idle_expires_at: Date }>(
        'select last_seen_at, idle_expires_at from sessions where token_hash = $1',
        [tokenHash],
      );
      expect(after.rows[0]?.last_seen_at).toStrictEqual(before.rows[0]?.last_seen_at);
      expect(after.rows[0]?.idle_expires_at).toStrictEqual(before.rows[0]?.idle_expires_at);
    },
  );

  evidenceTest('exact boundary semantics: expires_at <= authoritative_now is expired', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await admin.query(
      'update sessions set idle_expires_at = clock_timestamp() where token_hash = $1',
      [tokenHash],
    );
    expect(await store.resolveSession(tokenHash)).toBeUndefined();

    const tx = transaction();
    await store.beginAuthTransaction(tx);
    await admin.query(
      "update auth_transactions set created_at = clock_timestamp() - interval '10 minutes', expires_at = clock_timestamp() - interval '1 millisecond' where state_hash = $1",
      [tx.stateHash],
    );
    expect(await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash)).toBeUndefined();
  });

  evidenceTest('obsolete caller-time overloads do not exist in the database', async () => {
    const overloads = await admin.query<{ proname: string; args: string }>(
      `select p.proname::text, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = any($1) and pg_get_function_identity_arguments(p.oid) like '%timestamp with time zone%'`,
      [[...SESSION_FUNCTIONS]],
    );
    expect(overloads.rows).toHaveLength(0);
  });
});

describe('the session table guard', () => {
  evidenceTest(
    'keeps the absolute expiry fixed and revocation final, even for the owner',
    async () => {
      const person = await user();
      const { tokenHash } = await signIn(person.sub);
      await expect(
        admin.query(
          "update sessions set absolute_expires_at = absolute_expires_at + interval '1 day' where token_hash = $1",
          [tokenHash],
        ),
      ).rejects.toMatchObject({ code: '23000' });

      await store.revokeSession(tokenHash);
      await expect(
        admin.query(
          'update sessions set revoked_at = null, revocation_reason = null where token_hash = $1',
          [tokenHash],
        ),
      ).rejects.toMatchObject({ code: '23000' });
    },
  );
});
