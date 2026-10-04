/**
 * P06.06.01/.02: the sign-in and session functions, exercised as the real NOBYPASSRLS runtime role.
 *
 * Fixtures (users, direct row reads) go through the migration connection. Every behaviour under test
 * goes through `moin_identity`, the api-only role that alone may execute the six functions and that
 * touches none of the tables; `moin_app` — the voice and worker role — is shown to reach none of it.
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
const AUTH_TTL_MS = 10 * 60_000;
const T0 = new Date('2026-10-02T08:00:00.000Z');

let database: TestDatabase;
/** `moin_app`: tenant work in api, voice and worker. It must reach none of this. */
let app: Pool;
/** `moin_identity`: api's second pool, and the only role that may execute the session functions. */
let identity: Pool;
let admin: Pool;
let store: IdentityStore;

const hash = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();
const at = (ms: number): Date => new Date(T0.getTime() + ms);
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

async function signIn(subject: string, now = T0, replacedHash?: Buffer) {
  const tokenHash = hash();
  const granted = await store.beginSession({
    subject,
    tokenHash,
    sessionId: randomUUID(),
    providerTokensSealed: sealed(),
    keyId: 'test-v1',
    replacedHash,
    now,
  });
  return { tokenHash, granted };
}

/** Activity every 11 h, so the idle timeout never fires before `untilMs`. */
async function keepAlive(tokenHash: Buffer, untilMs: number): Promise<void> {
  for (let now = 11 * HOUR_MS; now < untilMs; now += 11 * HOUR_MS) {
    expect(
      await store.resolveSession(tokenHash, at(now)),
      `activity at +${String(now)} ms`,
    ).toBeDefined();
  }
}

function transaction(now = T0) {
  return {
    stateHash: hash(),
    bindingHash: hash(),
    nonceHash: hash(),
    verifierSealed: sealed(),
    keyId: 'test-v1',
    returnTo: '/today',
    now,
  };
}

/**
 * These tests walk fixed instants days apart, which the database's clock bound (`session_clock_policy`,
 * five minutes in every deployed database) refuses by design. This private test database widens it
 * through the admin connection; the bound itself is tested at its migrated value below.
 */
const WIDE_SKEW = "interval '100 years'";

async function clockSkew(value: string): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- the interval is one of two literals in this file, never input.
  await admin.query(`update session_clock_policy set max_skew = ${value}`);
}

beforeAll(async () => {
  database = await createTestDatabase('identity');
  app = database.pool();
  identity = database.identityPool();
  admin = createPool({ connectionString: database.migrationUrl, max: 4 });
  store = createIdentityStore(identity);
  await clockSkew(WIDE_SKEW);
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
  const now = new Date();
  return [
    [
      'begin_session',
      'select * from app.begin_session($1::text, $2::bytea, $3::uuid, $4::bytea, $5::text, null, $6::timestamptz)',
      [subject, hash(), randomUUID(), sealed(), 'test-v1', now],
    ],
    [
      'begin_sign_in',
      'select app.begin_sign_in($1::bytea, $2::bytea, $3::bytea, $4::bytea, $5::text, $6::text, $7::timestamptz)',
      [hash(), hash(), hash(), sealed(), 'test-v1', '/', now],
    ],
    [
      'consume_sign_in',
      'select * from app.consume_sign_in($1::bytea, $2::bytea, $3::timestamptz)',
      [hash(), hash(), now],
    ],
    [
      'resolve_session',
      'select * from app.resolve_session($1::bytea, $2::timestamptz)',
      [tokenHash, now],
    ],
    [
      'rotate_session',
      'select * from app.rotate_session($1::bytea, $2::bytea, $3::uuid, $4::text, $5::timestamptz)',
      [tokenHash, hash(), randomUUID(), 'step_up', now],
    ],
    ['revoke_session', 'select app.revoke_session($1::bytea, $2::timestamptz)', [tokenHash, now]],
  ];
}

describe('moin_app — the voice and worker role — and sessions', () => {
  evidenceTest(
    'cannot mint, resolve, rotate or revoke a session by calling the functions',
    async () => {
      const person = await user();
      const live = await signIn(person.sub, new Date());
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

  evidenceTest(
    'has no privilege on users, sign-in transactions, sessions or the clock policy',
    async () => {
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
        'select * from session_clock_policy',
        'delete from session_clock_policy',
        'update session_clock_policy set id = id',
      ]) {
        await expect(app.query(statement), statement).rejects.toMatchObject({ code: '42501' });
      }
      await expect(
        app.query(
          "insert into sessions (token_hash, id, family_id, user_id, rotation_reason, created_at, last_seen_at, idle_expires_at, absolute_expires_at, provider_tokens_sealed, provider_tokens_key_id) values ($1, $2, $2, $3, 'login', now(), now(), now(), now(), $4, 'k')",
          [hash(), randomUUID(), randomUUID(), sealed()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );
});

describe('moin_identity — the api-only session role', () => {
  evidenceTest('has no table privilege anywhere, tenant table or session table', async () => {
    for (const statement of [
      'select * from users',
      'select * from sessions',
      'select * from auth_transactions',
      'select * from session_clock_policy',
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
      ['session_clock', 'select app.session_clock(now())'],
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
    // eslint-disable-next-line no-restricted-syntax -- negative probe: the role must be unable to assume another, and the statement is refused before it could take effect.
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
      [[...SESSION_FUNCTIONS, 'reject_session_rewrite', 'session_clock'], roles],
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
    const first = await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash, at(1_000));
    expect(first).toStrictEqual({
      nonceHash: tx.nonceHash,
      verifierSealed: tx.verifierSealed,
      keyId: 'test-v1',
      returnTo: '/today',
    });
    expect(
      await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash, at(2_000)),
    ).toBeUndefined();
  });

  evidenceTest('is refused for an unknown state', async () => {
    expect(await store.consumeAuthTransaction(hash(), hash(), T0)).toBeUndefined();
  });

  evidenceTest('is refused and burnt when presented from another browser', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    expect(await store.consumeAuthTransaction(tx.stateHash, hash(), at(1_000))).toBeUndefined();
    // The right browser cannot use it afterwards either: a probe destroys what it probes.
    expect(
      await store.consumeAuthTransaction(tx.stateHash, tx.bindingHash, at(2_000)),
    ).toBeUndefined();
  });

  evidenceTest('expires exactly 10 minutes after it starts', async () => {
    const live = transaction();
    await store.beginAuthTransaction(live);
    expect(
      await store.consumeAuthTransaction(live.stateHash, live.bindingHash, at(AUTH_TTL_MS - 1)),
    ).toBeDefined();

    const stale = transaction();
    await store.beginAuthTransaction(stale);
    expect(
      await store.consumeAuthTransaction(stale.stateHash, stale.bindingHash, at(AUTH_TTL_MS)),
    ).toBeUndefined();
  });

  concurrentDuplicate();

  it('removes expired transactions when the next sign-in starts', async () => {
    const stale = transaction();
    await store.beginAuthTransaction(stale);
    await store.beginAuthTransaction(transaction(at(AUTH_TTL_MS)));
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
      Array.from({ length: 8 }, () =>
        store.consumeAuthTransaction(tx.stateHash, tx.bindingHash, at(1_000)),
      ),
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

  evidenceTest('stores the token digest and a 7-day absolute, 12-hour idle lifetime', async () => {
    const person = await user();
    const { tokenHash, granted } = await signIn(person.sub);
    expect(granted).toMatchObject({ userId: person.id, absoluteExpiresAt: at(ABSOLUTE_MS) });
    const row = await admin.query<{
      created_at: Date;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      rotation_reason: string;
    }>(
      'select created_at, idle_expires_at, absolute_expires_at, rotation_reason from sessions where token_hash = $1',
      [tokenHash],
    );
    expect(row.rows[0]).toStrictEqual({
      created_at: T0,
      idle_expires_at: at(IDLE_MS),
      absolute_expires_at: at(ABSOLUTE_MS),
      rotation_reason: 'login',
    });
  });

  evidenceTest('revokes the session the browser already held', async () => {
    const person = await user();
    const previous = await signIn(person.sub);
    const next = await signIn(person.sub, at(1_000), previous.tokenHash);
    expect(next.granted).toBeDefined();
    expect(await store.resolveSession(previous.tokenHash, at(2_000))).toBeUndefined();
    expect(await store.resolveSession(next.tokenHash, at(2_000))).toBeDefined();
  });
});

describe('a session over time', () => {
  evidenceTest('is rejected exactly 12 hours after its last activity', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    expect(await store.resolveSession(tokenHash, at(IDLE_MS - 1))).toBeDefined();

    const other = await signIn(person.sub);
    expect(await store.resolveSession(other.tokenHash, at(IDLE_MS))).toBeUndefined();
  });

  evidenceTest('is rejected exactly 7 days after sign-in, however active', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const step = 11 * HOUR_MS;
    let now = 0;
    while (now + step < ABSOLUTE_MS) {
      now += step;
      const resolved = await store.resolveSession(tokenHash, at(now));
      expect(resolved, `activity at +${String(now)} ms`).toBeDefined();
      expect(resolved?.absoluteExpiresAt).toStrictEqual(at(ABSOLUTE_MS));
      expect(resolved?.idleExpiresAt.getTime()).toBeLessThanOrEqual(at(ABSOLUTE_MS).getTime());
    }
    expect(await store.resolveSession(tokenHash, at(ABSOLUTE_MS - 1))).toBeDefined();
    expect(await store.resolveSession(tokenHash, at(ABSOLUTE_MS))).toBeUndefined();
  });

  evidenceTest('never lets idle expiry pass the absolute expiry', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await keepAlive(tokenHash, ABSOLUTE_MS - HOUR_MS);
    const resolved = await store.resolveSession(tokenHash, at(ABSOLUTE_MS - HOUR_MS));
    expect(resolved?.idleExpiresAt).toStrictEqual(at(ABSOLUTE_MS));
  });

  it('records a burst of activity as one write, never moving the idle expiry later', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const first = await store.resolveSession(tokenHash, at(HOUR_MS));
    const burst = await store.resolveSession(tokenHash, at(HOUR_MS + 59_000));
    expect(burst?.idleExpiresAt).toStrictEqual(first?.idleExpiresAt);
    expect(burst?.idleExpiresAt.getTime()).toBeLessThanOrEqual(
      at(HOUR_MS + 59_000 + IDLE_MS).getTime(),
    );
    const later = await store.resolveSession(tokenHash, at(HOUR_MS + 60_000));
    expect(later?.idleExpiresAt).toStrictEqual(at(HOUR_MS + 60_000 + IDLE_MS));
  });

  evidenceTest('is rejected after revocation and stays revoked', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    expect(await store.revokeSession(tokenHash, at(1_000))).toBe(true);
    expect(await store.resolveSession(tokenHash, at(2_000))).toBeUndefined();
    expect(await store.revokeSession(tokenHash, at(3_000))).toBe(false);
  });

  it('stops resolving once its user is disabled', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await admin.query("update users set status = 'disabled' where id = $1", [person.id]);
    expect(await store.resolveSession(tokenHash, at(1_000))).toBeUndefined();
  });
});

describe('rotation', () => {
  evidenceTest('issues a successor and leaves the predecessor unusable', async () => {
    const person = await user();
    const { tokenHash, granted } = await signIn(person.sub);
    const successor = hash();
    const rotated = await store.rotateSession(
      tokenHash,
      successor,
      randomUUID(),
      'step_up',
      at(HOUR_MS),
    );
    expect(rotated).toMatchObject({
      userId: person.id,
      absoluteExpiresAt: granted?.absoluteExpiresAt,
    });
    expect(await store.resolveSession(tokenHash, at(HOUR_MS + 1))).toBeUndefined();
    expect(await store.resolveSession(successor, at(HOUR_MS + 1))).toBeDefined();

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
    const { tokenHash } = await signIn(person.sub);
    const successor = hash();
    await keepAlive(tokenHash, ABSOLUTE_MS - HOUR_MS);
    const rotated = await store.rotateSession(
      tokenHash,
      successor,
      randomUUID(),
      'privilege_change',
      at(ABSOLUTE_MS - HOUR_MS),
    );
    expect(rotated?.absoluteExpiresAt).toStrictEqual(at(ABSOLUTE_MS));
    const resolved = await store.resolveSession(successor, at(ABSOLUTE_MS - 1));
    expect(resolved?.absoluteExpiresAt).toStrictEqual(at(ABSOLUTE_MS));
    expect(await store.resolveSession(successor, at(ABSOLUTE_MS))).toBeUndefined();
  });

  evidenceTest('leaves exactly one successor when rotations race', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const successors = Array.from({ length: 8 }, () => hash());
    const outcomes = await Promise.allSettled(
      successors.map((successor) =>
        store.rotateSession(tokenHash, successor, randomUUID(), 'step_up', at(1_000)),
      ),
    );
    // Every losing rotation is a refusal, not an error: the UNIQUE backstop never had to fire.
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const granted = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value !== undefined,
    );
    expect(granted).toHaveLength(1);
    const live = await Promise.all(successors.map((s) => store.resolveSession(s, at(2_000))));
    expect(live.filter((session) => session !== undefined)).toHaveLength(1);
  });

  evidenceTest('refuses a revoked or expired predecessor', async () => {
    const person = await user();
    const revoked = await signIn(person.sub);
    await store.revokeSession(revoked.tokenHash, at(1_000));
    expect(
      await store.rotateSession(revoked.tokenHash, hash(), randomUUID(), 'step_up', at(2_000)),
    ).toBeUndefined();

    const idle = await signIn(person.sub);
    expect(
      await store.rotateSession(idle.tokenHash, hash(), randomUUID(), 'step_up', at(IDLE_MS)),
    ).toBeUndefined();
  });

  it('refuses login as a rotation reason', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    await expect(
      identity.query('select * from app.rotate_session($1, $2, $3, $4, $5)', [
        tokenHash,
        hash(),
        randomUUID(),
        'login',
        at(1_000),
      ]),
    ).rejects.toMatchObject({ code: '22023' });
  });
});

const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_DEADLINE_MS = 5_000;

describe('two callers holding the same row', () => {
  /** Two connections, so the second statement provably waits on the first one's row lock. */
  async function interleaved<T>(
    first: (client: PoolClient) => Promise<T>,
    second: (client: PoolClient) => Promise<T>,
  ): Promise<{ first: T; second: T }> {
    const a = await identity.connect();
    const b = await identity.connect();
    try {
      await a.query('begin');
      const firstResult = await first(a);
      await b.query('begin');
      const pending = second(b);
      // Wait until the second statement is provably blocked on the lock, then let the first commit.
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
    'select * from app.begin_session($1::text, $2::bytea, $3::uuid, $4::bytea, $5::text, $6::bytea, $7::timestamptz)';

  evidenceTest(
    'a sign-in waiting behind a rotation of the session it supersedes revokes the successor too',
    async () => {
      const person = await user();
      const presented = await signIn(person.sub);
      const successor = hash();
      const next = hash();
      await interleaved(
        (client) =>
          client.query('select * from app.rotate_session($1, $2, $3, $4, $5)', [
            presented.tokenHash,
            successor,
            randomUUID(),
            'step_up',
            at(1_000),
          ]),
        (client) =>
          client.query(beginSessionSql, [
            person.sub,
            next,
            randomUUID(),
            sealed(),
            'test-v1',
            presented.tokenHash,
            at(2_000),
          ]),
      );
      expect(await store.resolveSession(successor, at(3_000)), 'rotated successor').toBeUndefined();
      expect(await store.resolveSession(next, at(3_000)), 'new sign-in').toBeDefined();
    },
  );

  evidenceTest(
    'a sign-in presenting a stale cookie supersedes a rotation in flight elsewhere in the family',
    async () => {
      const person = await user();
      const stale = await signIn(person.sub);
      const current = hash();
      await store.rotateSession(stale.tokenHash, current, randomUUID(), 'step_up', at(1_000));
      const inFlight = hash();
      const next = hash();
      await interleaved(
        (client) =>
          client.query('select * from app.rotate_session($1, $2, $3, $4, $5)', [
            current,
            inFlight,
            randomUUID(),
            'privilege_change',
            at(2_000),
          ]),
        (client) =>
          client.query(beginSessionSql, [
            person.sub,
            next,
            randomUUID(),
            sealed(),
            'test-v1',
            stale.tokenHash,
            at(3_000),
          ]),
      );
      expect(await store.resolveSession(inFlight, at(4_000)), 'rotated in flight').toBeUndefined();
      expect(await store.resolveSession(current, at(4_000))).toBeUndefined();
      expect(await store.resolveSession(next, at(4_000)), 'new sign-in').toBeDefined();
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
            at(1_000),
          ]),
        (client) =>
          client.query('select * from app.rotate_session($1, $2, $3, $4, $5)', [
            presented.tokenHash,
            successor,
            randomUUID(),
            'step_up',
            at(2_000),
          ]),
      );
      expect(second.rowCount).toBe(0);
      expect(await store.resolveSession(successor, at(3_000))).toBeUndefined();
      expect(await store.resolveSession(next, at(3_000))).toBeDefined();
    },
  );

  evidenceTest('a rotation waiting behind another rotation inserts nothing', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const rotate = (client: PoolClient) =>
      client.query('select * from app.rotate_session($1, $2, $3, $4, $5)', [
        tokenHash,
        hash(),
        randomUUID(),
        'step_up',
        at(1_000),
      ]);
    const { first, second } = await interleaved(rotate, rotate);
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
  });

  evidenceTest('a callback waiting behind another callback consumes nothing', async () => {
    const tx = transaction();
    await store.beginAuthTransaction(tx);
    const consume = (client: PoolClient) =>
      client.query('select * from app.consume_sign_in($1, $2, $3)', [
        tx.stateHash,
        tx.bindingHash,
        at(1_000),
      ]);
    const { first, second } = await interleaved(consume, consume);
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);
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
    await store.revokeSession(tokenHash, at(1_000));
    expect(await sealedOf(tokenHash)).toBeNull();

    const superseded = await signIn(person.sub);
    await signIn(person.sub, at(2_000), superseded.tokenHash);
    expect(await sealedOf(superseded.tokenHash)).toBeNull();
  });

  evidenceTest('move to the successor on rotation instead of being copied', async () => {
    const person = await user();
    const { tokenHash } = await signIn(person.sub);
    const before = await sealedOf(tokenHash);
    const successor = hash();
    await store.rotateSession(tokenHash, successor, randomUUID(), 'step_up', at(1_000));
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

describe('the clock a caller supplies', () => {
  evidenceTest(
    'must agree with the database clock, so time cannot be moved to revive or stretch a session',
    async () => {
      await clockSkew("interval '5 minutes'");
      try {
        const person = await user();
        const now = new Date();
        const tokenHash = hash();
        const issue = (when: Date) =>
          store.beginSession({
            subject: person.sub,
            tokenHash,
            sessionId: randomUUID(),
            providerTokensSealed: sealed(),
            keyId: 'test-v1',
            now: when,
          });
        // A session whose seven days would start a year from now.
        await expect(issue(new Date(now.getTime() + 365 * 24 * HOUR_MS))).rejects.toMatchObject({
          code: '22023',
        });
        expect(await issue(now)).toBeDefined();
        // Resolving "thirteen hours ago" would revive a session that idled out.
        await expect(
          store.resolveSession(tokenHash, new Date(now.getTime() - 13 * HOUR_MS)),
        ).rejects.toMatchObject({ code: '22023' });
        await expect(
          store.rotateSession(
            tokenHash,
            hash(),
            randomUUID(),
            'step_up',
            new Date(now.getTime() - HOUR_MS),
          ),
        ).rejects.toMatchObject({ code: '22023' });
        await expect(
          store.revokeSession(tokenHash, new Date(now.getTime() + HOUR_MS)),
        ).rejects.toMatchObject({
          code: '22023',
        });
        await expect(
          store.beginAuthTransaction(transaction(new Date(now.getTime() - HOUR_MS))),
        ).rejects.toMatchObject({
          code: '22023',
        });
        expect(await store.resolveSession(tokenHash, new Date())).toBeDefined();
      } finally {
        await clockSkew(WIDE_SKEW);
      }
    },
  );

  it('is migrated at five minutes, and the runtime role cannot change it', async () => {
    const fresh = await createTestDatabase('clockpolicy');
    try {
      const freshAdmin = createPool({ connectionString: fresh.migrationUrl, max: 1 });
      try {
        const policy = await freshAdmin.query<{ s: string }>(
          'select extract(epoch from max_skew)::text as s from session_clock_policy',
        );
        expect(policy.rows[0]?.s).toBe('300.000000');
      } finally {
        await freshAdmin.end();
      }
      await expect(
        fresh.pool().query("update session_clock_policy set max_skew = interval '1 year'"),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(fresh.pool().query('select * from session_clock_policy')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await fresh.drop();
    }
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

      await store.revokeSession(tokenHash, at(1_000));
      await expect(
        admin.query(
          'update sessions set revoked_at = null, revocation_reason = null where token_hash = $1',
          [tokenHash],
        ),
      ).rejects.toMatchObject({ code: '23000' });
    },
  );
});
