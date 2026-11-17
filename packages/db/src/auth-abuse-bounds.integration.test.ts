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

/** One take with an explicit refill rate; the rejection, if any, is the database error. */
async function takeWith(
  digest: Buffer,
  capacity: number,
  refillPerSecond: number,
): Promise<{ allowed: boolean }> {
  const result = await app.query<{ allowed: boolean }>(
    'select allowed from app.take_signin_bucket($1::text, $2::bytea, $3::double precision, $4::double precision, $5::double precision)',
    ['ip', digest, capacity, refillPerSecond, 1],
  );
  return { allowed: result.rows[0]?.allowed === true };
}

/** The overflow bucket's key in 0083 and 0084: the all-zero digest. */
const OVERFLOW_DIGEST = Buffer.alloc(32);

/** Waits until some backend is queued on an advisory lock. */
async function waitForAdvisoryWaiter(): Promise<void> {
  for (let i = 0; ; i += 1) {
    const queued = await fixtures.query<{ n: string }>(
      `select count(*)::text as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`,
    );
    if (queued.rows[0]?.n !== '0') return;
    if (i > 400) throw new Error('nothing queued on an advisory lock');
    await new Promise((done) => setTimeout(done, 25));
  }
}

const overflowUpdatedAt = async (): Promise<Date> => {
  const row = (
    await fixtures.query<{ updated_at: Date }>(
      "select updated_at from auth_throttle_buckets where scope = 'ip' and key_digest = $1::bytea",
      [OVERFLOW_DIGEST],
    )
  ).rows[0];
  if (row === undefined) throw new Error('no overflow bucket');
  return row.updated_at;
};

describe('a request that waited for its bucket refills against when it got it (X3)', () => {
  evidenceTest(
    'a newcomer that waited at saturation gets an answer, not a negative balance',
    async () => {
      // At the ceiling every newcomer shares the overflow bucket. One newcomer is held on its own
      // source's lock after it has read the clock; others draw on the overflow bucket meanwhile.
      // It must refill against the time it got the bucket: never a negative balance, and its
      // update must be later than theirs, or the next request would earn that interval again.
      await stageBuckets(MAX_BUCKETS);
      const waiter = key();
      const holder = await fixtures.connect();
      let pending: Promise<{ allowed: boolean }> | undefined;
      const seen = { before: Number.POSITIVE_INFINITY };
      try {
        await holder.query("select pg_advisory_lock(hashtext('ip:' || encode($1::bytea, 'hex')))", [
          waiter,
        ]);
        pending = takeWith(waiter, 3, 5);
        await waitForAdvisoryWaiter();
        await new Promise((done) => setTimeout(done, 1_500));
        for (let i = 0; i < 3; i += 1) await takeWith(key(), 3, 5);
        seen.before = (await overflowUpdatedAt()).getTime();
      } finally {
        await holder.query('select pg_advisory_unlock_all()');
        holder.release();
      }
      await expect(pending).resolves.toEqual({ allowed: expect.any(Boolean) as boolean });
      const negative = await fixtures.query('select 1 from auth_throttle_buckets where tokens < 0');
      expect(negative.rows).toStrictEqual([]);
      const after = await overflowUpdatedAt();
      expect(after.getTime()).toBeGreaterThan(seen.before);
    },
    60_000,
  );

  evidenceTest(
    'a newcomer queued on the overflow lock refills from the holder’s update (X4)',
    async () => {
      // At the ceiling a newcomer waits for the overflow lock. The holder empties the overflow
      // bucket before it lets go. The newcomer must refill against the time it got the lock:
      // reading the clock before that wait refills nothing and writes a time older than the
      // holder's.
      const refillPerSecond = 1;
      const capacity = 3;
      await stageBuckets(MAX_BUCKETS);
      await fixtures.query(
        `insert into auth_throttle_buckets (scope, key_digest, tokens, capacity, refill_per_second, updated_at)
         values ('ip', $1::bytea, 0, $2, $3, clock_timestamp())`,
        [OVERFLOW_DIGEST, capacity, refillPerSecond],
      );
      const holder = await fixtures.connect();
      let pending: Promise<{ allowed: boolean }> | undefined;
      let holderEpoch = Number.NaN;
      try {
        await holder.query("select pg_advisory_lock(hashtext('ip:' || encode($1::bytea, 'hex')))", [
          OVERFLOW_DIGEST,
        ]);
        pending = takeWith(key(), capacity, refillPerSecond);
        await waitForAdvisoryWaiter();
        // Long enough that a clock read before the wait is clearly older than the update below.
        await new Promise((done) => setTimeout(done, 1_500));
        const updated = await holder.query<{ at: string }>(
          `update auth_throttle_buckets set tokens = 0, updated_at = clock_timestamp()
            where scope = 'ip' and key_digest = $1::bytea
            returning extract(epoch from updated_at)::text as at`,
          [OVERFLOW_DIGEST],
        );
        holderEpoch = Number(updated.rows[0]?.at);
        // Long enough that the refill from the holder's update covers one take.
        await new Promise((done) => setTimeout(done, 1_500));
      } finally {
        await holder.query('select pg_advisory_unlock_all()');
        holder.release();
      }
      await expect(pending).resolves.toEqual({ allowed: true });
      const after = (
        await fixtures.query<{ at: string; tokens: number }>(
          `select extract(epoch from updated_at)::text as at, tokens from auth_throttle_buckets
            where scope = 'ip' and key_digest = $1::bytea`,
          [OVERFLOW_DIGEST],
        )
      ).rows[0];
      if (after === undefined) throw new Error('no overflow bucket');
      const afterEpoch = Number(after.at);
      expect(afterEpoch).toBeGreaterThan(holderEpoch);
      // One token taken from what accrued since the holder's update, and nothing more.
      const accrued = Math.min(capacity, (afterEpoch - holderEpoch) * refillPerSecond);
      expect(after.tokens).toBeCloseTo(accrued - 1, 6);
    },
    60_000,
  );

  evidenceTest('the sweep passes over a stale row another transaction holds', async () => {
    // An in-flight call of an earlier body holds a stale row it is deleting. A newcomer that sweeps
    // must pass over it, not wait for it while it holds the count row.
    await stageBuckets(5, '2 days');
    const held = (
      await fixtures.query<{ key_digest: Buffer }>(
        'select key_digest from auth_throttle_buckets order by key_digest limit 1',
      )
    ).rows[0]?.key_digest;
    if (held === undefined) throw new Error('no staged bucket');
    const holder = await fixtures.connect();
    try {
      await holder.query('begin');
      await holder.query('select 1 from auth_throttle_buckets where key_digest = $1 for update', [
        held,
      ]);
      const finished = await Promise.race([
        take(key(), 100).then(() => true),
        new Promise<boolean>((done) => {
          setTimeout(() => {
            done(false);
          }, 5_000);
        }),
      ]);
      expect(finished, 'the newcomer waited for a row another transaction holds').toBe(true);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    const remaining = await fixtures.query(
      'select 1 from auth_throttle_buckets where key_digest = $1',
      [held],
    );
    expect(remaining.rows).toHaveLength(1);
  });

  evidenceTest(
    'a sweep at saturation leaves a stale overflow bucket unlocked',
    async () => {
      // The overflow bucket is stale and the table is full of fresh buckets, so a newcomer sweeps,
      // frees nothing and waits for the overflow lock, held here. While it waits, the overflow row
      // must not be locked by it: the holder of the overflow lock may need that row next.
      await stageBuckets(MAX_BUCKETS);
      await fixtures.query(
        `insert into auth_throttle_buckets (scope, key_digest, tokens, capacity, refill_per_second, updated_at)
       values ('ip', $1::bytea, 3, 3, 0, clock_timestamp() - interval '2 days')`,
        [OVERFLOW_DIGEST],
      );
      const holder = await fixtures.connect();
      let pending: Promise<boolean> | undefined;
      try {
        await holder.query("select pg_advisory_lock(hashtext('ip:' || encode($1::bytea, 'hex')))", [
          OVERFLOW_DIGEST,
        ]);
        pending = take(key(), 3);
        await waitForAdvisoryWaiter();
        const prober = await fixtures.connect();
        try {
          await prober.query('begin');
          const locked = await prober
            .query(
              'select 1 from auth_throttle_buckets where key_digest = $1::bytea for update nowait',
              [OVERFLOW_DIGEST],
            )
            .then(
              () => false,
              (error: unknown) => {
                if ((error as { code?: string }).code !== '55P03') throw error;
                return true;
              },
            );
          await prober.query('rollback');
          expect(locked, 'the sweep locked the overflow bucket').toBe(false);
        } finally {
          prober.release();
        }
      } finally {
        await holder.query('select pg_advisory_unlock_all()');
        holder.release();
        await pending?.catch(() => undefined);
      }
    },
    60_000,
  );

  evidenceTest(
    'an in-flight call of the 0023 body and the current body never deadlock on a stale row',
    async () => {
      // A call of the previous body still running when 0083 committed deletes stale rows without
      // locking them first and then needs the count row; the current body holds the count row
      // while it sweeps. The current sweep skips rows another transaction holds.
      const previous = readFileSync(
        resolve(import.meta.dirname, '../migrations/0023_auth_throttle.sql'),
        'utf8',
      );
      const start = previous.indexOf('CREATE FUNCTION app.take_signin_bucket(');
      const end = previous.indexOf('$$;', start);
      if (start < 0 || end < 0) throw new Error('no 0023 body');
      const legacy = previous
        .slice(start, end + 3)
        .replace(
          'CREATE FUNCTION app.take_signin_bucket(',
          'CREATE FUNCTION app.legacy_take_0023(',
        );
      const owner = createPool({ connectionString: database.migrationUrl, max: 12 });
      await owner.query(legacy);
      try {
        await stageBuckets(400, '2 days');
        const legacyTake = (): Promise<unknown> =>
          owner.query(
            'select allowed from app.legacy_take_0023($1::text, $2::bytea, $3::double precision, $4::double precision, $5::double precision)',
            ['ip', key(), 100, 0, 1],
          );
        const outcomes = await Promise.allSettled(
          Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? legacyTake() : take(key(), 100))),
        );
        expect(
          outcomes
            .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
            .map((outcome) => String(outcome.reason)),
        ).toStrictEqual([]);
        expect(await admissionCount()).toBe(await bucketRows());
      } finally {
        await owner.query(
          'drop function app.legacy_take_0023(text, bytea, double precision, double precision, double precision)',
        );
        await owner.end();
      }
    },
    60_000,
  );
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
