/**
 * The authentication throttle and security event tables are bounded (P06.12.01, P06.12.02,
 * migration 0083, security acceptance G11 M3).
 *
 * Before 0082 a rotating scanner grew `auth_throttle_buckets` for as long as it kept rotating,
 * `auth_security_events` was never swept, and every refused request could write an event row.
 * These tests run the DEFINER functions as `moin_app`, the role that holds EXECUTE in production
 * (NOBYPASSRLS); the fixture pool only stages rows and reads them back. Synthetic keys only
 * (INV-16).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

/** The ceiling in 0083. */
const MAX_BUCKETS = 50_000;
const OVERFLOW_CAPACITY = 3;
const EVENT_SWEEP_CAP = 100;
/** The global ceiling on stored throttle refusals a minute in 0083. */
const MAX_THROTTLE_EVENTS_PER_MINUTE = 60;
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
  // The table's own triggers keep the count, for a fixture as for the function.
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

/** Stages `count` ordinary buckets the way the function would have, count included. */
async function stageBuckets(count: number, age = '0 seconds'): Promise<void> {
  await fixtures.query(
    `insert into auth_throttle_buckets (scope, key_digest, tokens, capacity, refill_per_second, updated_at)
     select 'ip', sha256(convert_to(i::text, 'UTF8')), 100, 100, 0, clock_timestamp() - $2::interval
       from generate_series(1, $1::int) i`,
    [count, age],
  );
}

const admissionCount = async (): Promise<number> =>
  Number(
    (
      await fixtures.query<{ n: string }>(
        'select live_buckets::text as n from auth_throttle_admission',
      )
    ).rows[0]?.n,
  );

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

const scalar = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await fixtures.query<{ n: string }>(sql, params)).rows[0]?.n);

const allEvents = (): Promise<number> =>
  scalar('select count(*)::text as n from auth_security_events');
const eventsOfClass = (cls: string): Promise<number> =>
  scalar('select count(*)::text as n from auth_security_events where class = $1', [cls]);
const eventsOlderThanAYear = (): Promise<number> =>
  scalar(
    "select count(*)::text as n from auth_security_events where created_at < clock_timestamp() - interval '1 year'",
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
      await stageBuckets(MAX_BUCKETS);
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
      // The overflow bucket is the one row the count leaves out.
      expect(await admissionCount()).toBe(MAX_BUCKETS);
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

describe('the ceiling holds under concurrency', () => {
  evidenceTest(
    'concurrent new sources at the last free slot cannot exceed the ceiling',
    async () => {
      await stageBuckets(MAX_BUCKETS - 1);
      await Promise.all(Array.from({ length: 12 }, () => take(key(), 100)));
      // One newcomer took the last slot; the others share the one overflow row.
      expect(await bucketRows()).toBe(MAX_BUCKETS + 1);
    },
    120_000,
  );

  evidenceTest('the count follows the table through concurrent sweeps and admissions', async () => {
    // 300 stale buckets: every take sweeps up to 100 of them while admitting its own source.
    await stageBuckets(300, '2 days');
    await Promise.all(Array.from({ length: 16 }, () => take(key(), 100)));
    expect(await admissionCount()).toBe(await bucketRows());
    expect(await bucketRows()).toBe(16);
  });

  evidenceTest(
    'sources returning to stale buckets while newcomers sweep them never deadlock',
    async () => {
      // 300 stale buckets. Forty of their own sources come back at once while forty new
      // sources are admitted and sweep: every request must be answered (a deadlock would
      // reject one with 40P01), and the count must still equal the table.
      await stageBuckets(300, '2 days');
      const returning = (
        await fixtures.query<{ key_digest: Buffer }>(
          'select key_digest from auth_throttle_buckets order by key_digest limit 40',
        )
      ).rows.map((row) => row.key_digest);
      const outcomes = await Promise.allSettled([
        ...returning.map((digest) => take(digest, 100)),
        ...Array.from({ length: 40 }, () => take(key(), 100)),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toStrictEqual([]);
      expect(await admissionCount()).toBe(await bucketRows());
    },
    60_000,
  );

  evidenceTest(
    'the count stays right when the previous function body writes the table',
    async () => {
      // A call of the 0023 body that was in flight when 0083 committed keeps running that
      // body. It knows nothing of the count; the table's triggers keep it anyway.
      const previous = readFileSync(
        resolve(import.meta.dirname, '../migrations/0023_auth_throttle.sql'),
        'utf8',
      );
      const start = previous.indexOf('CREATE FUNCTION app.take_signin_bucket(');
      const end = previous.indexOf('$$;', start);
      const current = (
        await fixtures.query<{ definition: string }>(
          "select pg_get_functiondef('app.take_signin_bucket(text, bytea, double precision, double precision, double precision)'::regprocedure) as definition",
        )
      ).rows[0]?.definition;
      if (start < 0 || end < 0 || current === undefined) throw new Error('no function body');
      await stageBuckets(150, '2 days');
      await fixtures.query(
        previous.slice(start, end + 3).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'),
      );
      try {
        await Promise.all(Array.from({ length: 12 }, () => take(key(), 100)));
      } finally {
        await fixtures.query(current);
      }
      expect(await admissionCount()).toBe(await bucketRows());
      await Promise.all(Array.from({ length: 12 }, () => take(key(), 100)));
      expect(await admissionCount()).toBe(await bucketRows());
    },
    60_000,
  );

  evidenceTest('a bucket in use is not swept from under its own request', async () => {
    // One stale bucket, taken again: the request sweeps, locks its own row and keeps its
    // slot, so the count is one whichever happens first.
    await stageBuckets(1, '2 days');
    const known = await fixtures.query<{ key_digest: Buffer }>(
      'select key_digest from auth_throttle_buckets',
    );
    expect(await take(known.rows[0]?.key_digest ?? key(), 100)).toBe(true);
    expect(await bucketRows()).toBe(1);
    expect(await admissionCount()).toBe(1);
  });

  evidenceTest('concurrent refusals from one source store one throttle event', async () => {
    const flooded = key();
    await Promise.all(Array.from({ length: 20 }, () => writeEvent('throttle', flooded)));
    expect(await eventsOfClass('throttle')).toBe(1);
  });

  evidenceTest('rotating sources cannot turn refusals into unbounded event rows', async () => {
    // Past the bucket ceiling every rotating source is refused under its own digest.
    for (let i = 0; i < MAX_THROTTLE_EVENTS_PER_MINUTE + 40; i += 1) {
      await writeEvent('throttle', key());
    }
    expect(await eventsOfClass('throttle')).toBe(MAX_THROTTLE_EVENTS_PER_MINUTE);
    // Other classes are not capped by it.
    await writeEvent('sign_in', key());
    expect(await eventsOfClass('sign_in')).toBe(1);
  });
});

describe('the overall limit on throttle events holds under concurrency', () => {
  evidenceTest('distinct sources racing for the last place store exactly one more', async () => {
    await fixtures.query(
      `insert into auth_security_events (id, outcome, class, reason_class, source_digest, created_at)
       select gen_random_uuid(), 'refused', 'throttle', 'rate_limited',
              sha256(convert_to(i::text, 'UTF8')), clock_timestamp()
         from generate_series(1, $1::int) i`,
      [MAX_THROTTLE_EVENTS_PER_MINUTE - 1],
    );
    await Promise.all(Array.from({ length: 12 }, () => writeEvent('throttle', key())));
    expect(await eventsOfClass('throttle')).toBe(MAX_THROTTLE_EVENTS_PER_MINUTE);
  });
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
    expect(await eventsOlderThanAYear()).toBe(OLD_EVENTS - EVENT_SWEEP_CAP);
    await writeEvent('sign_in', key());
    expect(await eventsOlderThanAYear()).toBe(0);
    // The eleven-month-old row and the two fresh ones survive.
    expect(await allEvents()).toBe(3);
  });

  evidenceTest('expired events of a class nobody writes any more are swept too', async () => {
    await fixtures.query(
      `insert into auth_security_events (id, outcome, class, reason_class, source_digest, created_at)
       select gen_random_uuid(), 'accepted', 'revoke', 'reset', $1::bytea,
              clock_timestamp() - interval '2 years'
         from generate_series(1, 5)`,
      [key()],
    );
    await writeEvent('sign_in', key());
    expect(await eventsOfClass('revoke')).toBe(0);
    expect(await eventsOlderThanAYear()).toBe(0);
  });

  evidenceTest('a throttle refusal is stored once per source per minute', async () => {
    const flooded = key();
    for (let i = 0; i < 5; i += 1) await writeEvent('throttle', flooded);
    expect(await eventsOfClass('throttle')).toBe(1);
    await writeEvent('throttle', key());
    expect(await eventsOfClass('throttle')).toBe(2);
    // Other classes are never deduplicated.
    const same = key();
    await writeEvent('sign_in', same);
    await writeEvent('sign_in', same);
    expect(await eventsOfClass('sign_in')).toBe(2);
  });
});
