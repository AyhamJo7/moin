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
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';

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
  await fixtures.query('delete from auth_throttle_buckets');
  await fixtures.query('delete from auth_security_events');
});

const key = (): Buffer => randomBytes(32);

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

describe('throttle refusals cannot flood the event table (G11 M3)', () => {
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
