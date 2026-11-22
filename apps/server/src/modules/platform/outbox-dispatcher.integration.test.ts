/**
 * The outbox dispatcher against real PostgreSQL and the SQS emulator (P08.02.02, P08.02.04):
 * rows are claimed and marked as `moin_dispatcher`, tenants paged and job rows written as
 * `moin_app`, envelopes sent to a real queue and, where it matters, run by the real consumer.
 * The event type, its route and the handler are test fixtures.
 */
import { createPool, type Pool } from '@moin/db/pool';
import { insertOutboxEvent, outboxEventSuperseded, withTenant, type JobHandler } from '@moin/db';
import { lintEnvelope, type JobEnvelope, type JobType } from '@moin/kernel';
import type { JobQueue } from '@moin/integrations';
import type { Logger } from '@moin/observability';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from 'vitest';
import { JobConsumer, JobHandlerRegistry } from './job-consumer.ts';
import { OutboxDispatcher, type OutboxDispatcherDeps } from './outbox-dispatcher.ts';
import { createTestQueues, type TestQueues } from './__fixtures__/sqs-queues.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ROUTED = 'test.routed';
const UNROUTED = 'test.unrouted';
const ROUTES: ReadonlyMap<string, JobType> = new Map([[ROUTED, 'sweep-run']]);
const VISIBILITY_S = 2;
const SEND_TIMEOUT_MS = 1_000;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

let database: TestDatabase;
let app: Pool;
let dispatcherPool: Pool;
let admin: Pool;
let queues: TestQueues;
const stops: (() => Promise<unknown>)[] = [];
const logLines: string[] = [];

const logger = {
  info: (...args: unknown[]) => logLines.push(JSON.stringify(args)),
  warn: (...args: unknown[]) => logLines.push(JSON.stringify(args)),
  error: (...args: unknown[]) => logLines.push(JSON.stringify(args)),
  debug: () => undefined,
  fatal: () => undefined,
  flush: () => undefined,
} as unknown as Logger;

beforeAll(async () => {
  database = await createTestDatabase('outbox-dispatcher');
  if (database.dispatcherUrl === undefined) {
    throw new Error('TEST_DATABASE_DISPATCHER_URL is not set; it is in .env.example');
  }
  app = database.pool();
  dispatcherPool = createPool({ connectionString: database.dispatcherUrl, max: 2 });
  admin = createPool({ connectionString: database.migrationUrl, max: 2 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
  await admin.query(`
    create table job_effects (
      organisation_id uuid not null references organisations (id),
      job_id uuid not null,
      unique (organisation_id, job_id)
    );
    alter table job_effects enable row level security;
    alter table job_effects force row level security;
    create policy job_effects_tenant on job_effects
      using (organisation_id = app.current_org()) with check (organisation_id = app.current_org());
    grant select, insert on job_effects to moin_app;
  `);
});

beforeEach(async () => {
  queues = await createTestQueues('outbox', VISIBILITY_S);
  await admin.query('delete from outbox');
});

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  await queues.drop();
  logLines.length = 0;
});

afterAll(async () => {
  await dispatcherPool.end();
  await admin.end();
  await database.drop();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error('condition not reached in time');
}

async function emit(
  org: string,
  eventType = ROUTED,
  aggregate = { id: crypto.randomUUID(), version: 1 },
): Promise<string> {
  return withTenant(app, org, (client) =>
    insertOutboxEvent(client, {
      aggregate: 'task',
      aggregateId: aggregate.id,
      aggregateVersion: aggregate.version,
      eventType,
      payload: { taskId: crypto.randomUUID() },
    }),
  );
}

/** Records which workload queue each send was resolved for. */
function recordingQueues(queue: JobQueue): {
  queueFor: (name: string) => JobQueue;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    queueFor: (name) => {
      asked.push(name);
      return queue;
    },
  };
}

function dispatcher(overrides: Partial<OutboxDispatcherDeps> = {}): OutboxDispatcher {
  return new OutboxDispatcher({
    appPool: app,
    dispatcherPool,
    queueFor: () => queues.queues.jobs,
    routes: ROUTES,
    logger,
    options: { intervalMs: 200, tenantPageSize: 1, batchSize: 50, sendTimeoutMs: SEND_TIMEOUT_MS },
    ...overrides,
  });
}

async function outboxRow(id: string) {
  const res = await admin.query<{ dispatched: boolean; attempts: number }>(
    `select dispatched_at is not null as dispatched, attempts from outbox where id = $1`,
    [id],
  );
  return res.rows[0];
}

async function jobRow(id: string) {
  const res = await admin.query<{
    organisation_id: string;
    type: string;
    status: string;
    queue_name: string;
  }>(`select organisation_id::text, type, status, queue_name from job_runs where id = $1`, [id]);
  return res.rows;
}

async function drain(queue: JobQueue): Promise<JobEnvelope[]> {
  const out: JobEnvelope[] = [];
  for (;;) {
    const batch = await queue.receive({ max: 10, waitSeconds: 1 });
    if (batch.length === 0) return out;
    for (const message of batch) {
      out.push(JSON.parse(message.body) as JobEnvelope);
      await queue.remove(message);
    }
  }
}

/** Makes the next attempt due now, instead of after the 30 s backoff. */
async function due(id: string): Promise<void> {
  await admin.query('update outbox set next_attempt_at = now() where id = $1', [id]);
}

const writeEffect: JobHandler = async ({ client, job }) => {
  await client.query(`insert into job_effects (organisation_id, job_id) values ($1, $2)`, [
    job.organisationId,
    job.id,
  ]);
};

describe('outbox dispatcher', () => {
  evidenceTest(
    'publishes each tenant event once, under its own tenant, after its job row',
    async () => {
      const a = await emit(ORG_A);
      const b = await emit(ORG_B);
      const resolver = recordingQueues(queues.queues.jobs);
      const report = await dispatcher({ queueFor: resolver.queueFor }).tick();
      expect(report).toEqual({ tenants: 2, published: 2, failedTenants: 0 });
      const sent = await drain(queues.queues.jobs);
      expect(sent.map((envelope) => [envelope.jobId, envelope.organisationId]).sort()).toEqual(
        [
          [a, ORG_A],
          [b, ORG_B],
        ].sort(),
      );
      for (const envelope of sent) expect(lintEnvelope(envelope).ok).toBe(true);
      expect(await jobRow(a)).toEqual([
        { organisation_id: ORG_A, type: 'sweep-run', status: 'queued', queue_name: 'sweeps' },
      ]);
      expect(await jobRow(b)).toEqual([
        { organisation_id: ORG_B, type: 'sweep-run', status: 'queued', queue_name: 'sweeps' },
      ]);
      // Sent to the workload queue the ledger row names, under a UUIDv7 job id.
      expect(resolver.asked).toEqual(['sweeps', 'sweeps']);
      expect(a).toMatch(UUID_V7);
      expect(await outboxRow(a)).toEqual({ dispatched: true, attempts: 0 });
      expect((await dispatcher().tick()).published).toBe(0);
      expect(await drain(queues.queues.jobs)).toEqual([]);
    },
  );

  evidenceTest(
    'a dispatcher that dies after the send, before the mark, resends and the job runs once',
    async () => {
      const id = await emit(ORG_A);
      let accepted = false;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hangAfterSend: JobQueue = {
        ...bind(queues.queues.jobs),
        send: async (body, attributes) => {
          await queues.queues.jobs.send(body, attributes);
          accepted = true;
          await held;
        },
      };
      const dying = dispatcher({
        queueFor: () => hangAfterSend,
        options: { intervalMs: 200, tenantPageSize: 1, batchSize: 50, sendTimeoutMs: 30_000 },
      });
      const tick = dying.tick();
      await until(() => Promise.resolve(accepted));
      // The queue has the envelope and the mark transaction is still open: the job row is already
      // committed and visible from another connection.
      expect(await jobRow(id)).toHaveLength(1);
      expect(await outboxRow(id)).toEqual({ dispatched: false, attempts: 0 });
      // Death of the process: its database session ends with the mark uncommitted.
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
          where usename = 'moin_dispatcher' and datname = current_database()`,
      );
      release();
      expect((await tick).failedTenants).toBe(1);
      expect(await outboxRow(id)).toEqual({ dispatched: false, attempts: 0 });

      // A restarted dispatcher finds the committed job and sends it again.
      expect((await dispatcher().tick()).published).toBe(1);
      expect(await outboxRow(id)).toEqual({ dispatched: true, attempts: 0 });

      let runs = 0;
      const consumer = new JobConsumer({
        pool: app,
        queue: queues.queues.jobs,
        deadLetter: queues.queues.deadLetter,
        handlers: new JobHandlerRegistry().register('sweep-run', 1, async (ctx) => {
          runs += 1;
          await writeEffect(ctx);
        }),
        logger,
        options: {
          concurrency: 2,
          visibilitySeconds: VISIBILITY_S,
          waitSeconds: 1,
          drainTimeoutMs: 5_000,
          handlerDeadlineSeconds: 30,
          busyRetrySeconds: 1,
          random: () => 0.5,
        },
      });
      consumer.start();
      stops.push(() => consumer.stop());
      await until(async () => (await jobRow(id))[0]?.status === 'succeeded');
      await until(async () => {
        const counts = await queues.counts('jobs');
        return counts.visible === 0 && counts.leased === 0;
      });
      expect(runs).toBe(1);
      const effects = await admin.query('select 1 from job_effects where job_id = $1', [id]);
      expect(effects.rows).toHaveLength(1);
      expect(await queues.counts('deadLetter')).toEqual({ visible: 0, leased: 0 });
    },
  );

  evidenceTest(
    'a retry after the route changed leaves the event undispatched and sends nothing',
    async () => {
      const id = await emit(ORG_A);
      const unreachable: JobQueue = {
        ...bind(queues.queues.jobs),
        send: () => Promise.reject(new Error('queue unreachable')),
      };
      expect((await dispatcher({ queueFor: () => unreachable }).tick()).published).toBe(0);
      expect(await jobRow(id)).toHaveLength(1);
      await due(id);
      const rerouted = dispatcher({ routes: new Map([[ROUTED, 'notification-send']]) });
      expect((await rerouted.tick()).published).toBe(0);
      expect(await outboxRow(id)).toEqual({ dispatched: false, attempts: 2 });
      expect((await jobRow(id))[0]?.type).toBe('sweep-run');
      expect(await drain(queues.queues.jobs)).toEqual([]);
      expect(logLines.join('\n')).toContain('job identity conflict');
    },
  );

  evidenceTest(
    'on shutdown a stalled send ends at its deadline and no further row is taken',
    async () => {
      const first = await emit(ORG_A);
      const second = await emit(ORG_A);
      let sends = 0;
      const stalled: JobQueue = {
        ...bind(queues.queues.jobs),
        send: () => {
          sends += 1;
          return new Promise<void>(() => undefined);
        },
      };
      const running = dispatcher({ queueFor: () => stalled });
      running.start();
      await until(() => Promise.resolve(sends === 1));
      const stopping = Date.now();
      await running.stop();
      expect(Date.now() - stopping).toBeLessThan(SEND_TIMEOUT_MS + 2_000);
      expect(sends).toBe(1);
      expect(await outboxRow(first)).toEqual({ dispatched: false, attempts: 1 });
      expect(await outboxRow(second)).toEqual({ dispatched: false, attempts: 0 });
    },
  );

  evidenceTest(
    'a failed send after the job row commits retries with the same job, not a new one',
    async () => {
      const id = await emit(ORG_A);
      let sends = 0;
      const failFirst: JobQueue = {
        ...bind(queues.queues.jobs),
        send: async (body, attributes) => {
          sends += 1;
          if (sends === 1) throw new Error('queue unreachable');
          await queues.queues.jobs.send(body, attributes);
        },
      };
      const flaky = dispatcher({ queueFor: () => failFirst });
      expect((await flaky.tick()).published).toBe(0);
      expect(await jobRow(id)).toHaveLength(1);
      expect(await drain(queues.queues.jobs)).toEqual([]);
      await due(id);
      expect((await flaky.tick()).published).toBe(1);
      const sent = await drain(queues.queues.jobs);
      expect(sent.map((envelope) => envelope.jobId)).toEqual([id]);
      expect(await jobRow(id)).toHaveLength(1);
      expect(await outboxRow(id)).toEqual({ dispatched: true, attempts: 1 });
    },
  );

  evidenceTest('an event with no route is not published and backs off', async () => {
    const id = await emit(ORG_A, UNROUTED);
    expect((await dispatcher().tick()).published).toBe(0);
    expect(await outboxRow(id)).toEqual({ dispatched: false, attempts: 1 });
    expect(await jobRow(id)).toEqual([]);
    expect(await drain(queues.queues.jobs)).toEqual([]);
    expect(logLines.join('\n')).toContain('unrouted');
  });

  evidenceTest('the dispatcher role reaches the outbox and cannot write a job row', async () => {
    const who = await dispatcherPool.query<{ name: string }>('select current_user as name');
    expect(who.rows[0]?.name).toBe('moin_dispatcher');
    await expect(
      withTenant(dispatcherPool, ORG_A, (client) =>
        client.query(
          `insert into job_runs (organisation_id, id, type, version, correlation_id, payload, queue_name, status)
           values (app.current_org(), gen_random_uuid(), 'sweep-run', 1, gen_random_uuid(), '{}', 'sweeps', 'queued')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/u);
    for (const probe of [
      'select 1 from job_runs limit 1',
      'update job_runs set id = id where false',
      'select 1 from timers limit 1',
      'update timers set id = id where false',
      'select 1 from provider_inbox limit 1',
      'update provider_inbox set id = id where false',
    ]) {
      await expect(dispatcherPool.query(probe), probe).rejects.toThrow(/permission denied/u);
    }
    // On the outbox, the dispatch state only; the event itself is not the dispatcher's to change.
    await expect(
      withTenant(dispatcherPool, ORG_A, (client) =>
        client.query(`update outbox set event_type = 'changed' where false`),
      ),
    ).rejects.toThrow(/permission denied/u);
    // And only the tenant in scope.
    await emit(ORG_B);
    const seen = await withTenant(dispatcherPool, ORG_A, (client) =>
      client.query<{ n: number }>(
        `select count(*)::int as n from outbox where organisation_id = $1`,
        [ORG_B],
      ),
    );
    expect(seen.rows[0]?.n).toBe(0);
  });

  evidenceTest(
    'a handler can tell that a newer version of the aggregate was already handled',
    async () => {
      const aggregate = crypto.randomUUID();
      const v1 = await emit(ORG_A, ROUTED, { id: aggregate, version: 1 });
      const v2 = await emit(ORG_A, ROUTED, { id: aggregate, version: 2 });
      await dispatcher().tick();
      // Version 2 is handled first; version 1 arrives after it.
      await admin.query(
        `update job_runs set status = 'succeeded', finished_at = now() where id = $1`,
        [v2],
      );
      const superseded = (id: string) =>
        withTenant(app, ORG_A, (client) => outboxEventSuperseded(client, id));
      expect(await superseded(v1)).toBe(true);
      expect(await superseded(v2)).toBe(false);
      // Not superseded by a newer version that has not run yet.
      const v3 = await emit(ORG_A, ROUTED, { id: aggregate, version: 3 });
      await dispatcher().tick();
      expect((await jobRow(v3))[0]?.status).toBe('queued');
      expect(await superseded(v2)).toBe(false);
      expect(await superseded(v3)).toBe(false);
    },
  );

  evidenceTest('the loop dispatches until stopped, then claims nothing more', async () => {
    const running = dispatcher();
    running.start();
    const first = await emit(ORG_A);
    await until(async () => (await outboxRow(first))?.dispatched === true);
    await running.stop();
    const later = await emit(ORG_A);
    await sleep(600);
    expect(await outboxRow(later)).toEqual({ dispatched: false, attempts: 0 });
  });
});

/** The queue's own methods, bound, so a test can override one of them. */
function bind(queue: JobQueue): JobQueue {
  return {
    receive: (options) => queue.receive(options),
    remove: (message) => queue.remove(message),
    hide: (message, seconds) => queue.hide(message, seconds),
    send: (body, attributes) => queue.send(body, attributes),
  };
}
