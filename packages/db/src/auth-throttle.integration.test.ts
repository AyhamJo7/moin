/**
 * Authentication throttle buckets under contention and at their bounds (P06.12.01, migration 0023).
 *
 * `auth-abuse.integration.test.ts` proves the throttle engages over HTTP and that a day-idle row is
 * swept. These tests pin three properties that suite cannot see, each of which a plausible edit to
 * `app.take_signin_bucket` would break while every existing test stayed green:
 *
 * 1. **The take is atomic under real concurrency.** Forty takes race on separate connections
 *    against a ten-token bucket that never refills: exactly ten may succeed.
 * 2. **The sweep never touches a live bucket.** An exhausted bucket idle for 23 h must survive
 *    another source's take. A sweep window that shrank would delete it, and the next request from
 *    that source would get a fresh, full bucket: a throttle bypass anyone can trigger by waiting.
 * 3. **The sweep is bounded per request.** One take deletes at most 100 stale rows, so a table
 *    full of a rotating scanner's one-shot rows never makes a single sign-in pay for all of them.
 *
 * Takes run as `moin_app`, the role that holds EXECUTE in production (NOBYPASSRLS). The fixture
 * pool only stages rows and reads them back. Synthetic keys only (INV-16).
 */
import { randomBytes } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

const RACERS = 40;
const RACE_CONNECTIONS = 8;
const RACE_CAPACITY = 10;
const SWEEP_CAP = 100;
const STALE_ROWS = 150;

let database: TestDatabase;
let app: Pool;
let fixtures: Pool;

beforeAll(async () => {
  database = await createTestDatabase('auth-throttle');
  app = createPool({ connectionString: database.appUrl, max: RACE_CONNECTIONS });
  fixtures = database.fixturePool();
}, 60_000);

afterAll(async () => {
  await app.end();
  await database.drop();
});

beforeEach(async () => {
  await fixtures.query('delete from auth_throttle_buckets');
});

const key = (): Buffer => randomBytes(32);

async function take(
  digest: Buffer,
  capacity: number,
  refillPerSecond: number,
): Promise<{ allowed: boolean; retry_after_ms: number }> {
  const result = await app.query<{ allowed: boolean; retry_after_ms: number }>(
    'select allowed, retry_after_ms from app.take_signin_bucket($1::text, $2::bytea, $3::double precision, $4::double precision, $5::double precision)',
    ['ip', digest, capacity, refillPerSecond, 1],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('take_signin_bucket returned no row');
  return row;
}

async function age(digest: Buffer, hours: number): Promise<void> {
  await fixtures.query(
    `update auth_throttle_buckets set updated_at = clock_timestamp() - make_interval(hours => $2)
     where key_digest = $1::bytea`,
    [digest, hours],
  );
}

async function staleCount(): Promise<number> {
  const result = await fixtures.query<{ n: string }>(
    `select count(*)::text as n from auth_throttle_buckets
     where updated_at < clock_timestamp() - interval '24 hours'`,
  );
  return Number(result.rows[0]?.n);
}

describe('auth throttle buckets (0023)', () => {
  evidenceTest('concurrent takes never grant more than the bucket holds', async () => {
    const digest = key();
    // refill 0: nothing can be earned back during the race, so any allowance above capacity
    // is a lost update, not timing.
    const outcomes = await Promise.allSettled(
      Array.from({ length: RACERS }, () => take(digest, RACE_CAPACITY, 0)),
    );
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    const allowed = outcomes.filter((o) => o.status === 'fulfilled' && o.value.allowed);
    expect(rejected).toStrictEqual([]);
    expect(allowed).toHaveLength(RACE_CAPACITY);
  });

  evidenceTest("a recently exhausted bucket survives another source's sweep", async () => {
    const attacker = key();
    expect((await take(attacker, 2, 0)).allowed).toBe(true);
    expect((await take(attacker, 2, 0)).allowed).toBe(true);
    expect((await take(attacker, 2, 0)).allowed).toBe(false);
    // Idle for most of a day, but not a full one: still a live bucket.
    await age(attacker, 23);
    // Any other source's request runs the opportunistic sweep.
    await take(key(), 200, 1);
    // Swept, it would be recreated full and the attacker would be let through.
    expect((await take(attacker, 2, 0)).allowed).toBe(false);
  });

  evidenceTest('one take sweeps at most 100 stale rows', async () => {
    await fixtures.query(
      `insert into auth_throttle_buckets (scope, key_digest, tokens, capacity, refill_per_second, updated_at)
       select 'ip', decode(md5(g::text) || md5((g + 1000)::text), 'hex'), 1, 1, 1,
              clock_timestamp() - interval '25 hours'
       from generate_series(1, $1::int) g`,
      [STALE_ROWS],
    );
    expect(await staleCount()).toBe(STALE_ROWS);
    await take(key(), 200, 1);
    expect(await staleCount()).toBe(STALE_ROWS - SWEEP_CAP);
    // The rest goes on the next request: the table stays bounded, the cost per call stays capped.
    await take(key(), 200, 1);
    expect(await staleCount()).toBe(0);
  });
});
