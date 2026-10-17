/**
 * Task rows and the tenant's audit head are locked in one order (P12.12.03, INV-10, INV-11; J3).
 *
 * `appendAuditEvent` takes the tenant's `audit_heads` row lock and holds it to COMMIT, so every
 * audit append serialises its tenant. A transaction that locks a task row and then appends audit
 * (an owner status change) therefore waits on the head; a transaction that appended audit and then
 * locks a task row (the callback capture adopting a finaliser fallback) used to wait the other
 * way. Two such transactions on one task formed a cycle PostgreSQL resolves by rolling one back
 * (40P01).
 *
 * Real PostgreSQL as `moin_app`. The interleaving is forced, not hoped for: the owner holds the
 * task row, the capture is started and observed waiting in `pg_locks`, and only then does the owner
 * run the real write (which appends audit). On the old order this deadlocks every time.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { verifyAuditChain } from './audit.ts';
import { captureCallbackRequest, type CallbackRequest } from './callback-intake.ts';
import { ingestCall } from './conversations.ts';
import { finaliseInteraction, reconcileOrphans } from './finaliser.ts';
import { createPool, type Pool } from './pool.ts';
import type { TenantClient } from './tenant.ts';
import { completeTask, reopenTask, setTaskStatus } from './tasks.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CALLER = '+4915112345678';
const LOCK_WAIT_DEADLINE_MS = 5_000;
const LOCK_WAIT_POLL_MS = 25;
const RACE_TEST_TIMEOUT_MS = 30_000;

let database: TestDatabase;
let app: Pool;
let admin: Pool;

interface Staged {
  readonly sid: string;
  readonly conversationId: string;
  readonly fallbackId: string;
}

function request(sid: string): CallbackRequest {
  return {
    providerCallSid: sid,
    fromNumber: CALLER,
    toNumber: '+494011110001',
    title: 'Rückruf: Tischreservierung',
  };
}

/** A call the finaliser covered with its open fallback, and no number yet: the capture adopts it. */
async function stage(org: string): Promise<Staged> {
  const sid = `SIM${randomUUID().replaceAll('-', '')}`;
  return withTenant(app, org, async (client) => {
    const ingested = await ingestCall(client, { providerCallSid: sid });
    const conversationId = ingested.call.conversationId;
    const fallback = await finaliseInteraction(client, conversationId);
    if (fallback.taskId === null) throw new Error('no fallback task');
    return { sid, conversationId, fallbackId: fallback.taskId };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True while `waiter` waits for a lock that `blocker` holds. */
async function isBlockedBy(waiter: number, blocker: number): Promise<boolean> {
  const result = await admin.query<{ blocked: boolean }>(
    'select $2::int = any(pg_blocking_pids($1::int)) as blocked',
    [waiter, blocker],
  );
  return result.rows[0]?.blocked === true;
}

async function waitUntilBlockedBy(waiter: () => number, blocker: () => number): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (waiter() !== 0 && blocker() !== 0 && (await isBlockedBy(waiter(), blocker()))) return;
    await sleep(LOCK_WAIT_POLL_MS);
  }
  throw new Error('the transaction never waited for the expected lock holder');
}

/** The sweep's backend is not reachable from outside: wait for any backend blocked by `blocker`. */
async function waitUntilAnyoneIsBlockedBy(blocker: () => number): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (blocker() !== 0) {
      const waiting = await admin.query(
        `select 1 from pg_locks l where not l.granted and $1::int = any(pg_blocking_pids(l.pid))`,
        [blocker()],
      );
      if (waiting.rows.length > 0) return;
    }
    await sleep(LOCK_WAIT_POLL_MS);
  }
  throw new Error('nothing waited for the expected lock holder');
}

async function backendPid(client: TenantClient): Promise<number> {
  const result = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  return result.rows[0]?.pid ?? 0;
}

interface Race {
  readonly owner: PromiseSettledResult<unknown>;
  readonly capture: PromiseSettledResult<{ taskId: string | null; replayed: boolean }>;
  readonly watcherError: unknown;
}

/**
 * The owner locks the task row; the capture starts and is seen waiting; only then does the owner
 * write through the real task functions (update, then audit append), and commit.
 */
async function raceCaptureAgainstOwner(
  org: string,
  staged: Staged,
  ownerWrite: (client: TenantClient) => Promise<unknown>,
): Promise<Race> {
  let capturePid = 0;
  let ownerPid = 0;
  let watcherError: unknown;
  let release!: () => void;
  const captureWaiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ownerHoldsRow!: () => void;
  const holds = new Promise<void>((resolve) => {
    ownerHoldsRow = resolve;
  });

  const owner = withTenant(app, org, async (client) => {
    ownerPid = await backendPid(client);
    await client.query('select id from tasks where id = $1 for update', [staged.fallbackId]);
    ownerHoldsRow();
    await captureWaiting;
    return ownerWrite(client);
  });
  owner.catch(() => undefined);
  await holds;

  const capture = withTenant(app, org, async (client) => {
    capturePid = await backendPid(client);
    return captureCallbackRequest(client, request(staged.sid));
  });
  capture.catch(() => undefined);
  // If the capture never waits the owner must still proceed, so the test fails by assertion and
  // does not hang.
  await waitUntilBlockedBy(
    () => capturePid,
    () => ownerPid,
  ).catch((error: unknown) => {
    watcherError = error;
  });
  release();

  const [ownerResult, captureResult] = await Promise.allSettled([owner, capture]);
  return { owner: ownerResult, capture: captureResult, watcherError };
}

/** SQLSTATEs of the rejected transactions: `40P01` is PostgreSQL rolling one back on a deadlock. */
function rejectionCodes(...results: readonly PromiseSettledResult<unknown>[]): string[] {
  return results.flatMap((result) => {
    if (result.status !== 'rejected') return [];
    const reason: unknown = result.reason;
    const code =
      typeof reason === 'object' && reason !== null
        ? (reason as { code?: unknown }).code
        : undefined;
    return [typeof code === 'string' ? code : 'unknown'];
  });
}

async function operationsOn(targetId: string): Promise<string[]> {
  const rows = await admin.query<{ operation: string }>(
    'select operation from audit_events where target_id = $1 order by seq',
    [targetId],
  );
  return rows.rows.map((r) => r.operation);
}

async function expectChainValid(org: string): Promise<void> {
  const verdict = await withTenant(app, org, (client) => verifyAuditChain(client));
  expect(verdict.valid).toBe(true);
}

async function taskRow(id: string) {
  const row = await admin.query<{
    status: string;
    title: string;
    type: string | null;
    version: number;
  }>('select status, title, type, version from tasks where id = $1', [id]);
  return row.rows[0];
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const result = await admin.query<{ n: number }>(sql, params);
  return result.rows[0]?.n ?? -1;
}

beforeAll(async () => {
  database = await createTestDatabase('task-audit-lock-order');
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

describe('a callback capture and an owner task write never deadlock (J3)', () => {
  evidenceTest(
    'the owner moves the adopted fallback while the capture waits: both commit, the capture retitles',
    async () => {
      const staged = await stage(ORG_A);
      const race = await raceCaptureAgainstOwner(ORG_A, staged, (client) =>
        setTaskStatus(client, staged.fallbackId, 'in_progress', 1),
      );

      expect(race.watcherError).toBeUndefined();
      expect(rejectionCodes(race.owner, race.capture)).toStrictEqual([]);
      expect(race.owner.status).toBe('fulfilled');
      expect(race.capture.status).toBe('fulfilled');
      if (race.capture.status !== 'fulfilled') return;
      expect(race.capture.value).toMatchObject({ taskId: staged.fallbackId, replayed: false });
      // Neither transition was lost: the owner's status and the capture's summary.
      expect(await taskRow(staged.fallbackId)).toMatchObject({
        status: 'in_progress',
        title: request(staged.sid).title,
        version: 3,
      });
      expect(await operationsOn(staged.fallbackId)).toStrictEqual([
        'task.create',
        'task.status',
        'task.retitle',
      ]);
      expect(
        await count(
          'select count(*)::int as n from callback_acceptances where conversation_id = $1',
          [staged.conversationId],
        ),
      ).toBe(1);
      expect(
        await count(
          `select count(*)::int as n from audit_events
           where operation = 'callback.accept' and target_id = $1`,
          [staged.conversationId],
        ),
      ).toBe(1);
      await expectChainValid(ORG_A);
    },
    RACE_TEST_TIMEOUT_MS,
  );

  for (const closing of ['done', 'cancelled'] as const) {
    evidenceTest(
      `the owner sets the fallback ${closing} while the capture waits: it stays ${closing}, a new task carries the request`,
      async () => {
        const staged = await stage(ORG_A);
        const race = await raceCaptureAgainstOwner(ORG_A, staged, (client) =>
          closing === 'done'
            ? completeTask(client, staged.fallbackId, 1)
            : setTaskStatus(client, staged.fallbackId, 'cancelled', 1),
        );

        expect(race.watcherError).toBeUndefined();
        expect(rejectionCodes(race.owner, race.capture)).toStrictEqual([]);
        expect(race.owner.status).toBe('fulfilled');
        expect(race.capture.status).toBe('fulfilled');
        if (race.capture.status !== 'fulfilled') return;
        const carrier = race.capture.value.taskId;
        expect(carrier).not.toBeNull();
        expect(carrier).not.toBe(staged.fallbackId);
        expect((await taskRow(staged.fallbackId))?.status).toBe(closing);
        expect(await taskRow(carrier ?? '')).toMatchObject({
          status: 'open',
          title: request(staged.sid).title,
          type: null,
        });
        expect(
          await count(
            'select count(*)::int as n from callback_acceptances where conversation_id = $1',
            [staged.conversationId],
          ),
        ).toBe(1);
        await expectChainValid(ORG_A);
      },
      RACE_TEST_TIMEOUT_MS,
    );
  }

  evidenceTest(
    'the finaliser repairing a closed fallback while the owner reopens it: both commit',
    async () => {
      const sid = `SIM${randomUUID().replaceAll('-', '')}`;
      // A done fallback and no outcome: the finaliser's repair path locks the row, which the owner holds.
      const staged = await withTenant(app, ORG_A, async (client) => {
        const ingested = await ingestCall(client, { providerCallSid: sid });
        const conversationId = ingested.call.conversationId;
        const fallback = await finaliseInteraction(client, conversationId);
        if (fallback.taskId === null) throw new Error('no fallback task');
        await completeTask(client, fallback.taskId, 1);
        return { sid, conversationId, fallbackId: fallback.taskId };
      });
      let finalising!: () => void;
      const reachedFinaliser = new Promise<void>((resolve) => {
        finalising = resolve;
      });
      let ownerHoldsRow!: () => void;
      const holds = new Promise<void>((resolve) => {
        ownerHoldsRow = resolve;
      });
      let ownerPid = 0;
      const owner = withTenant(app, ORG_A, async (client) => {
        ownerPid = await backendPid(client);
        await client.query('select id from tasks where id = $1 for update', [staged.fallbackId]);
        ownerHoldsRow();
        await reachedFinaliser;
        const row = await client.query<{ version: string }>(
          'select version::text from tasks where id = $1',
          [staged.fallbackId],
        );
        return reopenTask(client, staged.fallbackId, Number(row.rows[0]?.version));
      });
      owner.catch(() => undefined);
      await holds;
      let finaliserPid = 0;
      const finaliser = withTenant(app, ORG_A, async (client) => {
        finaliserPid = await backendPid(client);
        return finaliseInteraction(client, staged.conversationId);
      });
      finaliser.catch(() => undefined);
      await waitUntilBlockedBy(
        () => finaliserPid,
        () => ownerPid,
      );
      finalising();
      const [ownerResult, finaliserResult] = await Promise.allSettled([owner, finaliser]);

      expect(rejectionCodes(ownerResult, finaliserResult)).toStrictEqual([]);
      expect(ownerResult.status).toBe('fulfilled');
      expect(finaliserResult.status).toBe('fulfilled');
      if (finaliserResult.status !== 'fulfilled') return;
      // The owner's reopen already covers the interaction: nothing is minted.
      expect(finaliserResult.value.verdict).toBe('task-existed');
      expect((await taskRow(staged.fallbackId))?.status).toBe('open');
      await expectChainValid(ORG_A);
    },
    RACE_TEST_TIMEOUT_MS,
  );
});

describe('the audit head stays per tenant (J3)', () => {
  evidenceTest(
    'another tenant writes and captures freely while this tenant waits on a task row',
    async () => {
      const staged = await stage(ORG_A);
      const otherStaged = await stage(ORG_B);
      let capturePid = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ownerHoldsRow!: () => void;
      const holds = new Promise<void>((resolve) => {
        ownerHoldsRow = resolve;
      });
      let ownerPid = 0;
      const ownerA = withTenant(app, ORG_A, async (client) => {
        ownerPid = await backendPid(client);
        await client.query('select id from tasks where id = $1 for update', [staged.fallbackId]);
        ownerHoldsRow();
        await gate;
        return setTaskStatus(client, staged.fallbackId, 'in_progress', 1);
      });
      ownerA.catch(() => undefined);
      await holds;
      const captureA = withTenant(app, ORG_A, async (client) => {
        capturePid = await backendPid(client);
        return captureCallbackRequest(client, request(staged.sid));
      });
      captureA.catch(() => undefined);
      await waitUntilBlockedBy(
        () => capturePid,
        () => ownerPid,
      );

      // Tenant A is now blocked on its task row. Tenant B must not notice.
      const startedAt = Date.now();
      const otherOwner = await withTenant(app, ORG_B, (client) =>
        setTaskStatus(client, otherStaged.fallbackId, 'in_progress', 1),
      );
      const otherCapture = await withTenant(app, ORG_B, (client) =>
        captureCallbackRequest(client, request(otherStaged.sid)),
      );
      const otherElapsed = Date.now() - startedAt;
      expect(otherOwner.status).toBe('in_progress');
      expect(otherCapture.replayed).toBe(false);
      expect(await isBlockedBy(capturePid, ownerPid), 'tenant A is still waiting').toBe(true);
      expect(otherElapsed).toBeLessThan(LOCK_WAIT_DEADLINE_MS);

      release();
      const [ownerResult, captureResult] = await Promise.allSettled([ownerA, captureA]);
      expect(rejectionCodes(ownerResult, captureResult)).toStrictEqual([]);
      expect(ownerResult.status).toBe('fulfilled');
      expect(captureResult.status).toBe('fulfilled');
      await expectChainValid(ORG_A);
      await expectChainValid(ORG_B);
    },
    RACE_TEST_TIMEOUT_MS,
  );
});

/** An open call with no outcome, aged past the sweep's cutoff: what `reconcileOrphans` finalises. */
async function stageOrphan(
  org: string,
  minutesOld: number,
  closedFallback: boolean,
): Promise<{ sid: string; callId: string; conversationId: string; fallbackId: string | null }> {
  const sid = `SIM${randomUUID().replaceAll('-', '')}`;
  const staged = await withTenant(app, org, async (client) => {
    const ingested = await ingestCall(client, { providerCallSid: sid });
    let fallbackId: string | null = null;
    if (closedFallback) {
      const fallback = await finaliseInteraction(client, ingested.call.conversationId);
      if (fallback.taskId === null) throw new Error('no fallback task');
      await completeTask(client, fallback.taskId, 1);
      fallbackId = fallback.taskId;
    }
    return {
      sid,
      callId: ingested.call.id,
      conversationId: ingested.call.conversationId,
      fallbackId,
    };
  });
  await admin.query(
    `update conversations set updated_at = clock_timestamp() - make_interval(mins => $2)
     where id = $1`,
    [staged.conversationId, minutesOld],
  );
  await admin.query(
    `update calls set updated_at = clock_timestamp() - make_interval(mins => $2)
     where conversation_id = $1`,
    [staged.conversationId, minutesOld],
  );
  await admin.query(
    `update call_events set created_at = clock_timestamp() - make_interval(mins => $2)
     where call_id = $1`,
    [staged.callId, minutesOld],
  );
  return staged;
}

const SWEEP_CUTOFF_MINUTES = 10;
const OLDER_ORPHAN_MINUTES = 14;
const NEWER_ORPHAN_MINUTES = 12;

describe('the reconciler sweep takes its locks before the audit head (J3)', () => {
  evidenceTest(
    'an owner reopening the second orphan fallback while the sweep waits: both commit, nothing is lost',
    async () => {
      const first = await stageOrphan(ORG_A, OLDER_ORPHAN_MINUTES, false);
      const second = await stageOrphan(ORG_A, NEWER_ORPHAN_MINUTES, true);
      if (second.fallbackId === null) throw new Error('no fallback to hold');
      const fallbackId = second.fallbackId;
      let ownerPid = 0;
      let proceed!: () => void;
      const sweepWaiting = new Promise<void>((resolve) => {
        proceed = resolve;
      });
      let ownerHoldsRow!: () => void;
      const holds = new Promise<void>((resolve) => {
        ownerHoldsRow = resolve;
      });
      const owner = withTenant(app, ORG_A, async (client) => {
        ownerPid = await backendPid(client);
        await client.query('select id from tasks where id = $1 for update', [fallbackId]);
        ownerHoldsRow();
        await sweepWaiting;
        const row = await client.query<{ version: string }>(
          'select version::text from tasks where id = $1',
          [fallbackId],
        );
        return reopenTask(client, fallbackId, Number(row.rows[0]?.version));
      });
      owner.catch(() => undefined);
      await holds;
      const sweep = reconcileOrphans(app, { olderThanMinutes: SWEEP_CUTOFF_MINUTES });
      sweep.catch(() => undefined);
      await waitUntilAnyoneIsBlockedBy(() => ownerPid).finally(proceed);
      const [ownerResult, sweepResult] = await Promise.allSettled([owner, sweep]);

      expect(rejectionCodes(ownerResult, sweepResult)).toStrictEqual([]);
      expect(ownerResult.status).toBe('fulfilled');
      expect(sweepResult.status).toBe('fulfilled');
      if (sweepResult.status !== 'fulfilled') return;
      // The tenant's sweep committed: no rollback counted as a failure.
      expect(sweepResult.value.failed).toBe(0);
      const verdicts = new Map(sweepResult.value.orphans.map((o) => [o.conversationId, o.verdict]));
      expect(verdicts.get(first.conversationId)).toBe('fallback-created');
      // The owner's reopen already covers the second interaction: nothing is minted for it.
      expect(verdicts.get(second.conversationId)).toBe('task-existed');
      expect((await taskRow(fallbackId))?.status).toBe('open');
      await expectChainValid(ORG_A);
    },
    RACE_TEST_TIMEOUT_MS,
  );

  evidenceTest(
    'a callback capture of the second orphan holding its conversation lock while the sweep waits: both commit',
    async () => {
      const first = await stageOrphan(ORG_A, OLDER_ORPHAN_MINUTES, false);
      const second = await stageOrphan(ORG_A, NEWER_ORPHAN_MINUTES, false);
      let gatePid = 0;
      let capturePid = 0;
      let openGate!: () => void;
      const gateOpen = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      let gateHeld!: () => void;
      const held = new Promise<void>((resolve) => {
        gateHeld = resolve;
      });
      // Holds the second call's row, so the capture stops after taking the conversation lock and
      // before its first audit append.
      const gate = withTenant(app, ORG_A, async (client) => {
        gatePid = await backendPid(client);
        await client.query('select id from calls where id = $1 for update', [second.callId]);
        gateHeld();
        await gateOpen;
      });
      gate.catch(() => undefined);
      await held;
      const capture = withTenant(app, ORG_A, async (client) => {
        capturePid = await backendPid(client);
        return captureCallbackRequest(client, request(second.sid));
      });
      capture.catch(() => undefined);
      await waitUntilBlockedBy(
        () => capturePid,
        () => gatePid,
      );
      const sweep = reconcileOrphans(app, { olderThanMinutes: SWEEP_CUTOFF_MINUTES });
      sweep.catch(() => undefined);
      // The sweep reaches the second conversation's lock, which the capture holds.
      await waitUntilAnyoneIsBlockedBy(() => capturePid).finally(openGate);
      const [gateResult, captureResult, sweepResult] = await Promise.allSettled([
        gate,
        capture,
        sweep,
      ]);

      expect(rejectionCodes(gateResult, captureResult, sweepResult)).toStrictEqual([]);
      expect(captureResult.status).toBe('fulfilled');
      expect(sweepResult.status).toBe('fulfilled');
      if (captureResult.status !== 'fulfilled' || sweepResult.status !== 'fulfilled') return;
      expect(captureResult.value.replayed).toBe(false);
      expect(sweepResult.value.failed).toBe(0);
      const verdicts = new Map(sweepResult.value.orphans.map((o) => [o.conversationId, o.verdict]));
      expect(verdicts.get(first.conversationId)).toBe('fallback-created');
      // The capture committed its outcome first: the sweep finds nothing left to finalise.
      expect(verdicts.get(second.conversationId)).toBe('outcome-existed');
      expect(
        await count(
          'select count(*)::int as n from callback_acceptances where conversation_id = $1',
          [second.conversationId],
        ),
      ).toBe(1);
      await expectChainValid(ORG_A);
    },
    RACE_TEST_TIMEOUT_MS,
  );
});
