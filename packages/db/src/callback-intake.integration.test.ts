/**
 * Callback capture at the database layer (P12.12.03, INV-01, INV-11; M1 corrective hotfix).
 *
 * Real PostgreSQL as `moin_app` (NOBYPASSRLS) through `withTenant`. What the HTTP tests cannot
 * reach: a failure inside the capture transaction rolls every write back, a capture racing the
 * finaliser on one conversation converges on one carrying task, and `callback_acceptances` is a
 * tenant table the runtime role can only append to.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { captureCallbackRequest, type CallbackRequest } from './callback-intake.ts';
import { advanceCallStatus, ingestCall, recordOutcome } from './conversations.ts';
import { FALLBACK_TITLE, finaliseInteraction } from './finaliser.ts';
import { createPool, type Pool } from './pool.ts';
import { completeTask, createTask } from './tasks.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CALLER = '+4915112345678';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

function request(overrides: Partial<CallbackRequest> = {}): CallbackRequest {
  return {
    providerCallSid: `SIM${randomUUID().replaceAll('-', '')}`,
    fromNumber: CALLER,
    toNumber: '+494011110001',
    title: 'Rückruf: Tischreservierung',
    ...overrides,
  };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const result = await admin.query<{ n: number }>(sql, params);
  return result.rows[0]?.n ?? -1;
}

/** Everything a capture writes for one call SID, plus the tenant's audit total. */
async function footprint(sid: string) {
  const call = await admin.query<{ conversation_id: string; from_number: string | null }>(
    'select conversation_id, from_number from calls where provider_call_sid = $1',
    [sid],
  );
  const conversationId = call.rows[0]?.conversation_id ?? null;
  return {
    calls: call.rows.length,
    fromNumber: call.rows[0]?.from_number ?? null,
    outcomes: await count(
      'select count(*)::int as n from interaction_outcomes where conversation_id = $1',
      [conversationId],
    ),
    acceptances: await count(
      'select count(*)::int as n from callback_acceptances where provider_call_sid = $1',
      [sid],
    ),
    tasks: await count('select count(*)::int as n from tasks where conversation_id = $1', [
      conversationId,
    ]),
    titles: (
      await admin.query<{ title: string; version: number }>(
        'select title, version from tasks where conversation_id = $1 order by created_at',
        [conversationId],
      )
    ).rows,
    audit: await count('select count(*)::int as n from audit_events where organisation_id = $1', [
      ORG_A,
    ]),
  };
}

beforeAll(async () => {
  database = await createTestDatabase('callback-intake');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 2 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('a failed capture leaves nothing behind (M1 hotfix)', () => {
  evidenceTest('a write failing mid-capture rolls back the call, outcome and status', async () => {
    const bad = request({ title: 'x'.repeat(73) });
    await expect(
      withTenant(app, ORG_A, (client) => captureCallbackRequest(client, bad)),
    ).rejects.toThrow(RangeError);
    expect(await footprint(bad.providerCallSid)).toMatchObject({
      calls: 0,
      acceptances: 0,
      tasks: 0,
    });
    // The retry is a first delivery, applied once.
    const good = { ...bad, title: 'Rückruf: Tischreservierung' };
    const applied = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, good));
    expect(applied.replayed).toBe(false);
    expect(await footprint(good.providerCallSid)).toMatchObject({
      calls: 1,
      outcomes: 1,
      acceptances: 1,
      tasks: 1,
    });
  });

  evidenceTest('a failure after adoption restores the number, title and version', async () => {
    const input = request();
    await withTenant(app, ORG_A, async (client) => {
      const ingested = await ingestCall(client, { providerCallSid: input.providerCallSid });
      await finaliseInteraction(client, ingested.call.conversationId);
    });
    const before = await footprint(input.providerCallSid);
    expect(before.fromNumber).toBeNull();
    expect(before.titles).toStrictEqual([{ title: FALLBACK_TITLE, version: 1 }]);

    await expect(
      withTenant(app, ORG_A, async (client) => {
        await captureCallbackRequest(client, input);
        throw new Error('injected failure after the capture, before commit');
      }),
    ).rejects.toThrow('injected failure');
    expect(await footprint(input.providerCallSid)).toStrictEqual(before);

    await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    const after = await footprint(input.providerCallSid);
    expect(after.fromNumber).toBe(CALLER);
    expect(after.titles).toStrictEqual([{ title: input.title, version: 2 }]);
    expect(after.acceptances).toBe(1);
  });
});

describe('capture and finaliser on one conversation (M1 hotfix)', () => {
  evidenceTest('racing a finalise always converges on one carrying task', async () => {
    for (let round = 0; round < 12; round += 1) {
      const input = request();
      const conversationId = await withTenant(app, ORG_A, (client) =>
        ingestCall(client, { providerCallSid: input.providerCallSid }),
      ).then((ingested) => ingested.call.conversationId);
      const [captured] = await Promise.all([
        withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input)),
        withTenant(app, ORG_A, (client) => finaliseInteraction(client, conversationId)),
      ]);
      const state = await footprint(input.providerCallSid);
      expect(state, `round ${String(round)}`).toMatchObject({
        outcomes: 1,
        acceptances: 1,
        tasks: 1,
      });
      // Whichever ran first, the one task carries the request's summary.
      expect(state.titles[0]?.title).toBe(input.title);
      const carrier = await admin.query<{ task_id: string }>(
        'select task_id from callback_acceptances where provider_call_sid = $1',
        [input.providerCallSid],
      );
      expect(carrier.rows[0]?.task_id).toBe(captured.taskId);
    }
  });
});

describe('a replay writes nothing, before or after erasure and migration (M1 hotfix)', () => {
  evidenceTest(
    'a call captured before 0077 (no acceptance row) replays without a write',
    async () => {
      const input = request();
      // What the merged slice wrote for a capture: call, completed, outcome, task keyed by the
      // conversation; then the owner completed the task. No acceptance row existed then.
      const legacyTask = await withTenant(app, ORG_A, async (client) => {
        const ingested = await ingestCall(client, {
          providerCallSid: input.providerCallSid,
          fromNumber: input.fromNumber,
        });
        const conversationId = ingested.call.conversationId;
        await advanceCallStatus(client, ingested.call.id, 'completed');
        await recordOutcome(client, conversationId, {
          resultCode: 'callback_requested',
          handledAutomatically: true,
        });
        const task = await createTask(client, {
          title: input.title,
          type: 'callback',
          conversationId,
          idempotencyKey: `callback:${conversationId}`,
        });
        return completeTask(client, task.id, task.version);
      });
      const before = await footprint(input.providerCallSid);
      const events = await count(
        `select count(*)::int as n from call_events e join calls c on c.id = e.call_id
       where c.provider_call_sid = $1`,
        [input.providerCallSid],
      );
      const replay = await withTenant(app, ORG_A, (client) =>
        captureCallbackRequest(client, input),
      );
      expect(replay).toMatchObject({ taskId: legacyTask.id, replayed: true });
      expect(await footprint(input.providerCallSid)).toStrictEqual(before);
      expect(
        await count(
          `select count(*)::int as n from call_events e join calls c on c.id = e.call_id
         where c.provider_call_sid = $1`,
          [input.providerCallSid],
        ),
      ).toBe(events);
      const status = await admin.query<{ status: string }>(
        'select status from tasks where id = $1',
        [legacyTask.id],
      );
      expect(status.rows[0]?.status).toBe('done');
    },
  );

  evidenceTest('a fallback adopted before 0077 and then closed is not re-applied', async () => {
    const input = request();
    // What the merged slice wrote when it adopted a finaliser fallback: completed status and
    // the callback outcome, the fallback kept its own key; then the owner completed it.
    const fallback = await withTenant(app, ORG_A, async (client) => {
      const ingested = await ingestCall(client, { providerCallSid: input.providerCallSid });
      const conversationId = ingested.call.conversationId;
      const finalised = await finaliseInteraction(client, conversationId);
      await advanceCallStatus(client, ingested.call.id, 'completed');
      await recordOutcome(client, conversationId, {
        resultCode: 'callback_requested',
        handledAutomatically: true,
      });
      if (finalised.taskId === null) throw new Error('no fallback');
      return completeTask(client, finalised.taskId, 1);
    });
    const before = await footprint(input.providerCallSid);
    const replay = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    expect(replay).toMatchObject({ taskId: fallback.id, replayed: true });
    expect(await footprint(input.providerCallSid)).toStrictEqual(before);
  });

  evidenceTest('a live repair task from the finaliser carries the request', async () => {
    const input = request();
    const repair = await withTenant(app, ORG_A, async (client) => {
      const ingested = await ingestCall(client, { providerCallSid: input.providerCallSid });
      const conversationId = ingested.call.conversationId;
      const fallback = await finaliseInteraction(client, conversationId);
      await client.query(`update tasks set status = 'cancelled' where id = $1`, [fallback.taskId]);
      // The fallback is cancelled and no outcome exists: the finaliser repairs with a new task.
      const repaired = await finaliseInteraction(client, conversationId);
      return repaired.taskId;
    });
    const applied = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    expect(applied).toMatchObject({ taskId: repair, replayed: false });
    const state = await footprint(input.providerCallSid);
    expect(state.tasks).toBe(2);
    expect(state.titles.map((t) => t.title)).toContain(input.title);
  });

  evidenceTest('a replay after the conversation is erased recreates nothing', async () => {
    const input = request();
    const first = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    // Erasure (P16) runs as a privileged role: the conversation goes, the call cascades with it.
    await admin.query('delete from conversations where id = $1', [first.conversationId]);
    expect(await footprint(input.providerCallSid)).toMatchObject({ calls: 0, acceptances: 1 });
    const audit = (await footprint(input.providerCallSid)).audit;
    const replay = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    expect(replay.replayed).toBe(true);
    const after = await footprint(input.providerCallSid);
    expect(after).toMatchObject({ calls: 0, acceptances: 1, audit });
  });
});

describe('callback_acceptances is a tenant table the runtime role only appends to', () => {
  evidenceTest('another tenant sees none of the rows and cannot write into this one', async () => {
    const input = request();
    await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    const seenByB = await withTenant(app, ORG_B, (client) =>
      client.query('select * from callback_acceptances where provider_call_sid = $1', [
        input.providerCallSid,
      ]),
    );
    expect(seenByB.rows).toHaveLength(0);
    await expect(
      withTenant(app, ORG_B, (client) =>
        client.query(
          `insert into callback_acceptances (organisation_id, id, provider_call_sid, request_hash)
           values ($1, $2, 'SIMsmuggled01', $3)`,
          [ORG_A, randomUUID(), 'a'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/u);
  });

  evidenceTest('accepted rows cannot be rewritten or erased by moin_app', async () => {
    const input = request();
    await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    for (const sql of [
      `update callback_acceptances set request_hash = $2 where provider_call_sid = $1`,
      `delete from callback_acceptances where provider_call_sid = $1 and $2::text is not null`,
    ]) {
      await expect(
        withTenant(app, ORG_A, (client) =>
          client.query(sql, [input.providerCallSid, 'b'.repeat(64)]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  evidenceTest('an erased task leaves the acceptance: a replay still writes nothing', async () => {
    const input = request();
    const first = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    await withTenant(app, ORG_A, (client) =>
      client.query('delete from tasks where id = $1', [first.taskId]),
    );
    const before = await footprint(input.providerCallSid);
    expect(before).toMatchObject({ acceptances: 1, tasks: 0 });
    const replay = await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
    expect(replay).toStrictEqual({
      taskId: null,
      conversationId: first.conversationId,
      replayed: true,
    });
    expect(await footprint(input.providerCallSid)).toStrictEqual(before);
  });

  evidenceTest(
    'one acceptance per call: the unique constraint backs the replay check',
    async () => {
      const input = request();
      await withTenant(app, ORG_A, (client) => captureCallbackRequest(client, input));
      await expect(
        withTenant(app, ORG_A, (client) =>
          client.query(
            `insert into callback_acceptances (organisation_id, id, provider_call_sid, request_hash)
           values (app.current_org(), $1, $2, $3)`,
            [randomUUID(), input.providerCallSid, 'c'.repeat(64)],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    },
  );
});
