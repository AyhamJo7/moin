/**
 * The authentication throttle and security event tables are bounded (P06.12.01, P06.12.02,
 * migration 0082, security acceptance G11 M3).
 *
 * Before 0082 a rotating scanner grew `auth_throttle_buckets` for as long as it kept rotating,
 * `auth_security_events` was never swept, and every refused request could write an event row.
 * These tests run the DEFINER functions as `moin_app`, the role that holds EXECUTE in production
 * (NOBYPASSRLS); the fixture pool only stages rows and reads them back. Synthetic keys only
 * (INV-16).
 */
import { randomBytes } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

/** The ceiling in 0082. */
const MAX_BUCKETS = 50_000;
const OVERFLOW_CAPACITY = 3;
const EVENT_SWEEP_CAP = 100;
const OLD_EVENTS = 150;

let database: TestDatabase;
let app: Pool;
let fixtures: Pool;

beforeAll(async () => {
  database = await createTestDatabase('auth-abuse-bounds');
  app = createPool({ connectionString: database.appUrl, max: 4 });
  fixtures = database.fixturePool();
}, 60_000);

afterAll(async () => {
  await app.end();
  await database.drop();
});

beforeEach(async () => {
  await fixtures.query('delete from auth_throttle_buckets');
  await fixtures.query('delete from auth_security_events');
});

const key = (): Buffer => randomBytes(32);

async function take(digest: Buffer, capacity: number): Promise<boolean> {
  const result = await app.query<{ allowed: boolean }>(
    'select allowed from app.take_signin_bucket($1::text, $2::bytea, $3::double precision, $4::double precision, $5::double precision)',
    ['ip', digest, capacity, 0, 1],
  );
  return result.rows[0]?.allowed === true;
}

const bucketRows = async (): Promise<number> =>
  Number(
    (await fixtures.query<{ n: string }>('select count(*)::text as n from auth_throttle_buckets'))
      .rows[0]?.n,
  );

async function writeEvent(cls: string, digest: Buffer): Promise<void> {
  await app.query(
    'select app.write_signin_event($1::text, $2::text, $3::text, $4::bytea, $5::boolean)',
    ['refused', cls, 'rate_limited', digest, false],
  );
}

const eventRows = async (where = 'true'): Promise<number> =>
  Number(
    (
      await fixtures.query<{ n: string }>(
        `select count(*)::text as n from auth_security_events where ${where}`,
      )
    ).rows[0]?.n,
  );

describe('the throttle table has a ceiling (G11 M3)', () => {
  evidenceTest('below the ceiling a new source gets its own bucket', async () => {
    const digest = key();
    expect(await take(digest, 5)).toBe(true);
    expect(await bucketRows()).toBe(1);
  });

  evidenceTest(
    'past the ceiling new sources share one overflow bucket and get no row',
    async () => {
      await fixtures.query(
        `insert into auth_throttle_buckets (scope, key_digest, tokens, capacity, refill_per_second)
         select 'ip', sha256(convert_to(i::text, 'UTF8')), 100, 100, 0
           from generate_series(1, $1::int) i`,
        [MAX_BUCKETS],
      );
      expect(await bucketRows()).toBe(MAX_BUCKETS);
      // Rotating sources: the first OVERFLOW_CAPACITY draw on the shared bucket, the rest are
      // refused, and the table gains the one overflow row and nothing else.
      const outcomes: boolean[] = [];
      for (let i = 0; i < OVERFLOW_CAPACITY + 4; i += 1) {
        outcomes.push(await take(key(), OVERFLOW_CAPACITY));
      }
      expect(outcomes).toStrictEqual([
        ...Array<boolean>(OVERFLOW_CAPACITY).fill(true),
        ...Array<boolean>(4).fill(false),
      ]);
      expect(await bucketRows()).toBe(MAX_BUCKETS + 1);
      // A source that already has a row keeps its own budget.
      const known = await fixtures.query<{ key_digest: Buffer }>(
        'select key_digest from auth_throttle_buckets limit 1',
      );
      expect(await take(known.rows[0]?.key_digest ?? key(), 100)).toBe(true);
      expect(await bucketRows()).toBe(MAX_BUCKETS + 1);
    },
    120_000,
  );
});

describe('security events are retained for one year (G11 M3)', () => {
  evidenceTest('each write sweeps at most 100 events older than a year', async () => {
    await fixtures.query(
      `insert into auth_security_events (id, outcome, class, reason_class, source_digest, created_at)
       select gen_random_uuid(), 'refused', 'sign_in', 'callback', $1::bytea,
              clock_timestamp() - interval '2 years'
         from generate_series(1, $2::int)`,
      [key(), OLD_EVENTS],
    );
    await fixtures.query(
      `insert into auth_security_events (id, outcome, class, reason_class, source_digest, created_at)
       values (gen_random_uuid(), 'refused', 'sign_in', 'callback', $1::bytea,
               clock_timestamp() - interval '11 months')`,
      [key()],
    );
    await writeEvent('sign_in', key());
    expect(await eventRows("created_at < clock_timestamp() - interval '1 year'")).toBe(
      OLD_EVENTS - EVENT_SWEEP_CAP,
    );
    await writeEvent('sign_in', key());
    expect(await eventRows("created_at < clock_timestamp() - interval '1 year'")).toBe(0);
    // The eleven-month-old row and the two fresh ones survive.
    expect(await eventRows()).toBe(3);
  });

  evidenceTest('a throttle refusal is stored once per source per minute', async () => {
    const flooded = key();
    for (let i = 0; i < 5; i += 1) await writeEvent('throttle', flooded);
    expect(await eventRows("class = 'throttle'")).toBe(1);
    await writeEvent('throttle', key());
    expect(await eventRows("class = 'throttle'")).toBe(2);
    // Other classes are never deduplicated.
    const same = key();
    await writeEvent('sign_in', same);
    await writeEvent('sign_in', same);
    expect(await eventRows("class = 'sign_in'")).toBe(2);
  });
});
