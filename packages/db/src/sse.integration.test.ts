/**
 * SSE event store (P08.08.02/.04): publish + replay, tenant isolation,
 * reconnect replay, outage fallback (poll the store). Synthetic only (INV-16).
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { createPool, type Pool } from './pool.ts';
import { publishEvent, replaySince } from './sse.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('sse');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('sse', () => {
  evidenceTest('reconnect replays missed events in order', async () => {
    const first = await withTenant(app, ORG_A, (client) =>
      publishEvent(client, {
        userId: USER_A,
        type: 'task.created',
        payload: { taskId: randomUUID() },
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      publishEvent(client, {
        userId: USER_A,
        type: 'task.updated',
        payload: { taskId: randomUUID() },
      }),
    );
    expect(second).toBeGreaterThan(first);
    // Fresh connect replays everything; reconnect replays only the miss.
    const all = await withTenant(app, ORG_A, (client) =>
      replaySince(client, { userId: USER_A, lastEventId: 0 }),
    );
    expect(all.map((e) => e.eventId)).toContain(first);
    expect(all.map((e) => e.eventId)).toContain(second);
    const missed = await withTenant(app, ORG_A, (client) =>
      replaySince(client, { userId: USER_A, lastEventId: first }),
    );
    expect(missed.map((e) => e.eventId)).toEqual([second]);
    expect(missed[0]?.type).toBe('task.updated');
  });

  evidenceTest('a tenant never receives another tenant’s events', async () => {
    const id = await withTenant(app, ORG_A, (client) =>
      publishEvent(client, { userId: USER_A, type: 'task.created', payload: {} }),
    );
    expect(id).toBeGreaterThan(0);
    // Same user id, other tenant: FORCE RLS hides A's rows.
    const foreign = await withTenant(app, ORG_B, (client) =>
      replaySince(client, { userId: USER_A, lastEventId: 0 }),
    );
    expect(foreign).toEqual([]);
    // Other user, same tenant: user-scoped channel.
    const other = await withTenant(app, ORG_A, (client) =>
      replaySince(client, { userId: randomUUID(), lastEventId: 0 }),
    );
    expect(other).toEqual([]);
  });

  evidenceTest('Valkey outage fallback: the store is the poll source', async () => {
    // Degraded mode (P08.08.03) polls this store every 30 s — proven here by
    // polling twice and getting the same rows (the poll is the fallback).
    const id = await withTenant(app, ORG_A, (client) =>
      publishEvent(client, { userId: USER_A, type: 'lead.created', payload: {} }),
    );
    const pollA = await withTenant(app, ORG_A, (client) =>
      replaySince(client, { userId: USER_A, lastEventId: id - 1 }),
    );
    const pollB = await withTenant(app, ORG_A, (client) =>
      replaySince(client, { userId: USER_A, lastEventId: id - 1 }),
    );
    expect(pollA.map((e) => e.eventId)).toEqual(pollB.map((e) => e.eventId));
    expect(pollA.map((e) => e.eventId)).toContain(id);
  });
});

describe('sse replay orders by the numeric event id (SEC-G04 F1 pattern)', () => {
  const REPLAY_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  evidenceTest('replay returns the next numbers, not the next strings', async () => {
    // Identifiers 8 to 19 cross the one-to-two digit boundary: sorted as text, '10' to '19' come
    // before '8' and '9', so a client resuming at 7 with a small page would skip them.
    const START = 8; // keep equal to the literal restart value below
    const COUNT = 12;
    await admin.query('alter table sse_events alter column event_id restart with 8');
    const published: number[] = [];
    await withTenant(app, ORG_A, async (client) => {
      for (let i = 0; i < COUNT; i += 1) {
        published.push(
          await publishEvent(client, { userId: REPLAY_USER, type: 'task.created', payload: {} }),
        );
      }
    });
    expect(published).toStrictEqual(Array.from({ length: COUNT }, (_, i) => START + i));

    const page = await withTenant(app, ORG_A, (client) =>
      replaySince(client, { userId: REPLAY_USER, lastEventId: START - 1, limit: 3 }),
    );
    expect(page.map((e) => e.eventId)).toStrictEqual([8, 9, 10]);

    const seen: number[] = [];
    let cursor = START - 1;
    for (let guard = 0; guard < 20; guard += 1) {
      const next = await withTenant(app, ORG_A, (client) =>
        replaySince(client, { userId: REPLAY_USER, lastEventId: cursor, limit: 5 }),
      );
      if (next.length === 0) break;
      seen.push(...next.map((e) => e.eventId));
      cursor = next.at(-1)?.eventId ?? cursor;
    }
    expect(seen).toStrictEqual(published);
  });
});
