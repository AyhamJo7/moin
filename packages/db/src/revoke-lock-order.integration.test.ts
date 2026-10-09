/**
 * Revocation lock order (P06.06.05 H1, migration 0027).
 *
 * Deterministic RED/GREEN concurrency regression: a gate transaction holds family+session
 * rows FOR UPDATE (the reader side of the old AB-BA), the revoker starts against those held
 * locks, and the gate then requests the users row FOR UPDATE. On the OLD bodies the revoker
 * takes users first (holds users, waits on sessions) while the gate holds sessions and waits
 * on users: a true AB-BA cycle, 40P01 on one side. On the new bodies (families → sessions →
 * users last) no path takes users before sessions, so the gate's users lock is granted, the
 * gate commits, and the revoker proceeds — never 40P01 either side.
 *
 * Runs as the migration role through raw SQL (lock-order proof, not application
 * behaviour); synthetic data only (INV-16).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

let database: TestDatabase;
let admin: Pool;

const hash = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

beforeAll(async () => {
  database = await createTestDatabase('revoke-lock-order');
  admin = createPool({ connectionString: database.migrationUrl, max: 4 });
}, 60_000);

afterAll(async () => {
  await admin.end();
  await database.drop();
});

async function person(): Promise<{ id: string }> {
  const id = randomUUID();
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    randomUUID(),
    `${randomUUID().slice(0, 8)}@example.test`,
    'active',
  ]);
  return { id };
}

async function liveSession(userId: string): Promise<Buffer> {
  const tokenHash = hash();
  const sessionId = randomUUID();
  await admin.query(
    `insert into sessions (token_hash, id, family_id, user_id, rotation_reason, created_at,
       last_seen_at, idle_expires_at, absolute_expires_at, provider_tokens_sealed, provider_tokens_key_id)
     values ($1::bytea, $2::uuid, $2::uuid, $3::uuid, 'login', now(), now(),
       now() + interval '12 hours', now() + interval '7 days', $4::bytea, 'test-v1')`,
    [tokenHash, sessionId, userId, randomBytes(64)],
  );
  return tokenHash;
}

describe('revocation lock order (0027)', () => {
  evidenceTest('revoker and session reader proceed without 40P01', async () => {
    const { id } = await person();
    await liveSession(id);
    // Gate: the reader side — family + session rows FOR UPDATE, held open.
    const gate = await admin.connect();
    // Revoker side: runs concurrently once the gate holds its locks.
    const revoker = await admin.connect();
    try {
      await gate.query('begin');
      await gate.query(
        `select 1 from sessions f where f.id in
           (select s.family_id from sessions s where s.user_id = $1::uuid and s.revoked_at is null)
         order by f.id for update`,
        [id],
      );
      await gate.query(
        `select 1 from sessions s where s.user_id = $1::uuid and s.revoked_at is null
         order by s.id for update`,
        [id],
      );
      // Revoker starts now: on the old bodies it takes the users row first and blocks on
      // the gate's session locks; the gate then asks for the users row (readers end with
      // family → session → users) and blocks on the revoker: AB-BA, 40P01 on one side.
      // On the new bodies the revoker takes no early users lock, so the gate's users
      // lock is granted at once, the gate commits, and the revoker proceeds.
      const revoking = revoker.query('select app.revoke_user_sessions($1::uuid, null, $2::text)', [
        id,
        'membership_removed',
      ]);
      // Let the revoker reach its first lock request (users on old bodies, sessions on new),
      // then take the gate's users lock — the lock that closes the AB-BA cycle on old code.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const gating = gate.query('select 1 from users u where u.id = $1::uuid for update', [id]);
      await gating;
      await gate.query('commit');
      const result = await revoking;
      const revoked = (result.rows[0] as { revoke_user_sessions: number }).revoke_user_sessions;
      expect(revoked).toBeGreaterThanOrEqual(1);
      // And the sessions are actually revoked (fresh snapshot saw them).
      const left = await admin.query<{ n: string }>(
        'select count(*)::text as n from sessions where user_id = $1::uuid and revoked_at is null',
        [id],
      );
      expect(left.rows[0]?.n).toBe('0');
    } finally {
      try {
        await gate.query('rollback');
      } catch {
        // Already committed above on the happy path.
      }
      gate.release();
      revoker.release();
    }
  });

  evidenceTest('set_user_status flips and revokes in one commit', async () => {
    const { id } = await person();
    await liveSession(id);
    const org = randomUUID();
    await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
      org,
      `l-${org.slice(0, 8)}`,
      'Lock Org',
    ]);
    // The setter's audit DEFINER reads the tenant from app.current_org(): call inside
    // withTenant for the target's organisation, exactly as the recovery controller does.
    const { withTenant } = await import('./tenant.ts');
    const settled = await withTenant(database.pool(), org, async (gate) =>
      gate.query<{ changed: boolean; revoked: number }>(
        'select * from app.set_user_status($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid)',
        [id, 'disabled', 'password_reset', randomUUID(), randomUUID()],
      ),
    );
    expect(settled.rows[0]?.changed).toBe(true);
    expect(settled.rows[0]?.revoked).toBeGreaterThanOrEqual(1);
  });
});
