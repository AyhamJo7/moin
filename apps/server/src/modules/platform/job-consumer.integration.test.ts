/**
 * The job consumer against real PostgreSQL (as `moin_app`, FORCE RLS) and a real SQS-compatible
 * emulator (P08.05.01–.04, INV-11, INV-19). The job type and every handler here are test fixtures:
 * they prove the worker infrastructure, not a production callback-to-outbox pipeline.
 */
import { createPool, type Pool } from '@moin/db/pool';
import { enqueueJob, withTenant, type JobHandler } from '@moin/db';
import { JobFailure, uuidv7, type JobEnvelope } from '@moin/kernel';
import type { JobQueue, QueueMessage } from '@moin/integrations';
import type { Logger } from '@moin/observability';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from 'vitest';
import { JobConsumer, JobHandlerRegistry, type JobConsumerOptions } from './job-consumer.ts';
import { createTestQueues, type TestQueues } from './__fixtures__/sqs-queues.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const SENTINEL = 'caller-Maria-Schmidt-+4930123456';
const VISIBILITY_S = 2;

let database: TestDatabase;
let app: Pool;
let admin: Pool;
let queues: TestQueues;
const consumers: JobConsumer[] = [];
const logLines: string[] = [];

const logger = {
  info: (...args: unknown[]) => logLines.push(JSON.stringify(args)),
  warn: (...args: unknown[]) => logLines.push(JSON.stringify(args, errorReplacer)),
  error: (...args: unknown[]) => logLines.push(JSON.stringify(args, errorReplacer)),
  debug: () => undefined,
  fatal: () => undefined,
  flush: () => undefined,
} as unknown as Logger;

function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}

beforeAll(async () => {
  database = await createTestDatabase('job-consumer');
  app = database.pool();
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

// A queue per test: a message left invisible by one test must never surface in the next.
beforeEach(async () => {
  queues = await createTestQueues('consumer', VISIBILITY_S);
});

afterEach(async () => {
  await Promise.all(consumers.splice(0).map((c) => c.stop()));
  await queues.drop();
  logLines.length = 0;
});

afterAll(async () => {
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

interface Seed {
  readonly envelope: JobEnvelope;
  readonly body: string;
}

async function seed(
  org = ORG_A,
  type: 'sweep-run' | 'postcall-finalise' = 'sweep-run',
): Promise<Seed> {
  const jobId = uuidv7();
  const correlationId = uuidv7();
  const payload = { taskId: uuidv7() };
  await withTenant(app, org, (client) =>
    enqueueJob(client, { jobId, type, correlationId, payload }),
  );
  const envelope: JobEnvelope = {
    jobId,
    type,
    version: 1,
    organisationId: org,
    correlationId,
    traceContext: null,
    attempt: 0,
    notBefore: null,
    payload,
  };
  return { envelope, body: JSON.stringify(envelope) };
}

const writeEffect: JobHandler = async ({ client, job }) => {
  await client.query(`insert into job_effects (organisation_id, job_id) values ($1, $2)`, [
    job.organisationId,
    job.id,
  ]);
};

async function effects(jobId: string): Promise<number> {
  const res = await admin.query<{ n: string }>(
    `select count(*)::text as n from job_effects where job_id = $1`,
    [jobId],
  );
  return Number(res.rows[0]?.n);
}

async function ledger(jobId: string) {
  const res = await admin.query<{ status: string; attempt: number; error_code: string | null }>(
    `select status, attempt, error_code from job_runs where id = $1`,
    [jobId],
  );
  return res.rows[0];
}

function makeConsumer(
  handlers: JobHandlerRegistry,
  overrides: Partial<JobConsumerOptions> = {},
  queue: JobQueue = queues.queues.jobs,
  deadLetter: JobQueue = queues.queues.deadLetter,
  isShuttingDown?: () => boolean,
): JobConsumer {
  const consumer = new JobConsumer({
    pool: app,
    queue,
    deadLetter,
    handlers,
    logger,
    isShuttingDown,
    options: {
      concurrency: 2,
      visibilitySeconds: VISIBILITY_S,
      waitSeconds: 1,
      drainTimeoutMs: 5_000,
      handlerDeadlineSeconds: 30,
      busyRetrySeconds: 1,
      random: () => 0.5,
      ...overrides,
    },
  });
  consumers.push(consumer);
  return consumer;
}

function registry(handler: JobHandler, type: 'sweep-run' | 'postcall-finalise' = 'sweep-run') {
  return new JobHandlerRegistry().register(type, 1, handler);
}

async function receiveOne(queue: JobQueue, waitSeconds = 5): Promise<QueueMessage | undefined> {
  const [message] = await queue.receive({ max: 1, waitSeconds });
  return message;
}

describe('job consumer over SQS and PostgreSQL', () => {
  evidenceTest(
    'a valid message executes one durable effect and is deleted after commit',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      makeConsumer(registry(writeEffect)).start();
      await until(async () => (await ledger(job.envelope.jobId))?.status === 'succeeded');
      expect(await effects(job.envelope.jobId)).toBe(1);
      await sleep(VISIBILITY_S * 1000 + 500);
      expect(await queues.counts('jobs')).toEqual({ visible: 0, leased: 0 });
    },
  );

  evidenceTest('duplicate deliveries of one message do not repeat the effect', async () => {
    const job = await seed();
    for (let i = 0; i < 3; i += 1) await queues.queues.jobs.send(job.body);
    makeConsumer(registry(writeEffect)).start();
    await until(async () => (await ledger(job.envelope.jobId))?.status === 'succeeded');
    await sleep(VISIBILITY_S * 1000 + 1500);
    expect(await effects(job.envelope.jobId)).toBe(1);
    expect((await ledger(job.envelope.jobId))?.attempt).toBe(1);
    expect(await queues.queues.jobs.receive({ max: 10, waitSeconds: 0 })).toHaveLength(0);
  });

  evidenceTest('two workers racing on one logical job create one effect', async () => {
    const job = await seed();
    let runs = 0;
    const slow: JobHandler = async (ctx) => {
      runs += 1;
      await sleep(600);
      await writeEffect(ctx);
    };
    for (let i = 0; i < 4; i += 1) await queues.queues.jobs.send(job.body);
    makeConsumer(registry(slow)).start();
    makeConsumer(registry(slow)).start();
    await until(async () => (await ledger(job.envelope.jobId))?.status === 'succeeded');
    await sleep(VISIBILITY_S * 1000 + 1500);
    expect(runs).toBe(1);
    expect(await effects(job.envelope.jobId)).toBe(1);
    expect(await queues.queues.jobs.receive({ max: 10, waitSeconds: 0 })).toHaveLength(0);
  });

  evidenceTest(
    'a transient failure is retried under the policy and the message is hidden for the backoff',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      makeConsumer(
        registry(async (ctx) => {
          await writeEffect(ctx);
          throw new Error(`provider said ${SENTINEL}`);
        }),
      ).start();
      await until(async () => (await ledger(job.envelope.jobId))?.error_code === 'handler-error');
      expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'queued', attempt: 1 });
      expect(await effects(job.envelope.jobId)).toBe(0);
      // Backoff for the first retry is 30 s (jitter fixed at the midpoint): the message was not
      // deleted, it is leased out for the backoff, and nothing went to the DLQ.
      await sleep(VISIBILITY_S * 1000 + 1000);
      expect(await queues.counts('jobs')).toEqual({ visible: 0, leased: 1 });
      expect(await queues.counts('deadLetter')).toEqual({ visible: 0, leased: 0 });
    },
  );

  evidenceTest(
    'the last allowed attempt failing sends the message to the DLQ with a reason',
    async () => {
      const job = await seed();
      await admin.query(`update job_runs set attempt = 2 where id = $1`, [job.envelope.jobId]);
      await queues.queues.jobs.send(job.body);
      makeConsumer(registry(() => Promise.reject(new JobFailure('provider-timeout')))).start();
      const dead = await receiveOne(queues.queues.deadLetter, 10);
      expect(dead?.attributes).toEqual({ reason: 'provider-timeout' });
      expect(dead?.body).toBe(job.body);
      expect(await ledger(job.envelope.jobId)).toMatchObject({
        status: 'dead',
        error_code: 'provider-timeout',
      });
      await sleep(VISIBILITY_S * 1000 + 500);
      expect(await queues.queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
    },
  );

  evidenceTest('a permanent failure goes to the DLQ at the first attempt', async () => {
    const job = await seed();
    await queues.queues.jobs.send(job.body);
    makeConsumer(registry(() => Promise.reject(new JobFailure('unsupported-shape', true)))).start();
    const dead = await receiveOne(queues.queues.deadLetter, 10);
    expect(dead?.attributes['reason']).toBe('unsupported-shape');
    expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'dead', attempt: 1 });
  });

  evidenceTest(
    'schema-invalid messages are dead-lettered without invoking any handler',
    async () => {
      let calls = 0;
      const spy: JobHandler = () => {
        calls += 1;
        return Promise.resolve();
      };
      const job = await seed();
      const bodies = [
        'not json at all',
        JSON.stringify({ ...job.envelope, payload: { taskId: 'call +4930123456' } }),
        JSON.stringify({ ...job.envelope, type: 'drop-database' }),
        JSON.stringify({ ...job.envelope, organisationId: null }),
      ];
      for (const body of bodies) await queues.queues.jobs.send(body);
      makeConsumer(registry(spy)).start();
      const reasons: string[] = [];
      while (reasons.length < bodies.length) {
        const dead = await receiveOne(queues.queues.deadLetter, 10);
        reasons.push(dead?.attributes['reason'] ?? 'none');
        if (dead !== undefined) await queues.queues.deadLetter.remove(dead);
      }
      expect(reasons.sort()).toEqual([
        'envelope-invalid',
        'envelope-invalid',
        'envelope-invalid',
        'tenant-required',
      ]);
      expect(calls).toBe(0);
      expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
    },
  );

  evidenceTest('a job claimed for the wrong tenant fails closed and runs nothing', async () => {
    const job = await seed(ORG_A);
    let calls = 0;
    const spy: JobHandler = () => {
      calls += 1;
      return Promise.resolve();
    };
    await queues.queues.jobs.send(JSON.stringify({ ...job.envelope, organisationId: ORG_B }));
    makeConsumer(registry(spy)).start();
    const dead = await receiveOne(queues.queues.deadLetter, 10);
    expect(dead?.attributes['reason']).toBe('job-unknown');
    expect(calls).toBe(0);
    expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
  });

  evidenceTest(
    'a failed DLQ send keeps the original; the redelivery completes the dead-lettering',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      let failures = 0;
      const flaky: JobQueue = {
        ...queues.queues.deadLetter,
        receive: (o) => queues.queues.deadLetter.receive(o),
        remove: (m) => queues.queues.deadLetter.remove(m),
        hide: (m, s) => queues.queues.deadLetter.hide(m, s),
        send: (body, attributes) => {
          failures += 1;
          return failures === 1
            ? Promise.reject(new Error('dlq unavailable'))
            : queues.queues.deadLetter.send(body, attributes);
        },
      };
      makeConsumer(
        registry(() => Promise.reject(new JobFailure('unsupported-shape', true))),
        {},
        queues.queues.jobs,
        flaky,
      ).start();
      await until(() => Promise.resolve(failures >= 1));
      // The ledger already says dead, but the message was not deleted: no silent loss.
      expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'dead' });
      const dead = await receiveOne(queues.queues.deadLetter, 10);
      expect(dead?.attributes['reason']).toBe('already-dead');
      await sleep(VISIBILITY_S * 1000 + 500);
      expect(await queues.queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
    },
  );

  evidenceTest(
    'visibility is extended while a long job runs, so no second delivery happens',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = false;
      makeConsumer(
        registry(async (ctx) => {
          started = true;
          await gate;
          await writeEffect(ctx);
        }),
      ).start();
      await until(() => Promise.resolve(started));
      // Three times the visibility timeout passes; an unextended lease would have lapsed twice.
      for (let waited = 0; waited < VISIBILITY_S * 3000; waited += 500) {
        await sleep(500);
        expect(await queues.queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
      }
      // A lapsed lease would have redelivered the message to this consumer, which reports it busy.
      expect(logLines.filter((line) => line.includes('"busy"'))).toEqual([]);
      release();
      await until(async () => (await ledger(job.envelope.jobId))?.status === 'succeeded');
      expect(await effects(job.envelope.jobId)).toBe(1);
    },
  );

  evidenceTest(
    'a crash after the commit and before the delete does not repeat the effect',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      let removeFailures = 0;
      const crashing: JobQueue = {
        receive: (o) => queues.queues.jobs.receive(o),
        hide: (m, s) => queues.queues.jobs.hide(m, s),
        send: (b, a) => queues.queues.jobs.send(b, a),
        remove: (m) => {
          removeFailures += 1;
          return removeFailures === 1
            ? Promise.reject(new Error('lost before delete'))
            : queues.queues.jobs.remove(m);
        },
      };
      let runs = 0;
      makeConsumer(
        registry(async (ctx) => {
          runs += 1;
          await writeEffect(ctx);
        }),
        {},
        crashing,
      ).start();
      await until(() => Promise.resolve(removeFailures >= 2));
      await sleep(VISIBILITY_S * 1000 + 500);
      expect(runs).toBe(1);
      expect(await effects(job.envelope.jobId)).toBe(1);
      expect(await queues.queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
    },
  );

  evidenceTest(
    'a crash before the commit leaves the message for redelivery and no effect behind',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      let runs = 0;
      makeConsumer(
        registry(async (ctx) => {
          runs += 1;
          await writeEffect(ctx);
          if (runs === 1) await ctx.client.query('select pg_terminate_backend(pg_backend_pid())');
        }),
      ).start();
      await until(async () => (await ledger(job.envelope.jobId))?.status === 'succeeded');
      expect(runs).toBe(2);
      expect(await effects(job.envelope.jobId)).toBe(1);
    },
  );

  evidenceTest('shutdown drains in-flight work, then acknowledges it', async () => {
    const job = await seed();
    await queues.queues.jobs.send(job.body);
    let started = false;
    const consumer = makeConsumer(
      registry(async (ctx) => {
        started = true;
        await sleep(800);
        await writeEffect(ctx);
      }),
    );
    consumer.start();
    await until(() => Promise.resolve(started));
    expect(await consumer.stop()).toEqual({ abandoned: 0 });
    expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'succeeded' });
    await sleep(VISIBILITY_S * 1000 + 500);
    expect(await queues.queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
  });

  evidenceTest(
    'shutdown past the drain budget acknowledges nothing; a restarted worker completes it once',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = false;
      const first = makeConsumer(
        registry(async (ctx) => {
          started = true;
          await gate;
          await writeEffect(ctx);
        }),
        { drainTimeoutMs: 200 },
      );
      first.start();
      await until(() => Promise.resolve(started));
      expect(await first.stop()).toEqual({ abandoned: 1 });
      release();
      await sleep(500);
      // The abandoned delivery finished its transaction but must not have touched the queue.
      expect(await receiveOne(queues.queues.jobs, 5)).toBeDefined();
      const second = makeConsumer(registry(writeEffect));
      second.start();
      await until(
        async () =>
          (await queues.queues.jobs.receive({ max: 1, waitSeconds: 0 })).length === 0 && true,
      );
      await sleep(VISIBILITY_S * 1000 + 1000);
      expect(await effects(job.envelope.jobId)).toBe(1);
      expect((await ledger(job.envelope.jobId))?.status).toBe('succeeded');
    },
  );

  evidenceTest('a process shutting down takes no new work', async () => {
    const job = await seed();
    await queues.queues.jobs.send(job.body);
    makeConsumer(
      registry(writeEffect),
      {},
      queues.queues.jobs,
      queues.queues.deadLetter,
      () => true,
    ).start();
    await sleep(1500);
    expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
    expect(await receiveOne(queues.queues.jobs, 3)).toBeDefined();
  });

  evidenceTest(
    'a job type with no handler is left on the queue unclaimed, never acknowledged as processed',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      makeConsumer(new JobHandlerRegistry()).start();
      await until(() => Promise.resolve(logLines.some((l) => l.includes('handler-unavailable'))));
      await sleep(300);
      expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
      expect(await queues.counts('jobs')).toEqual({ visible: 0, leased: 1 });
    },
  );

  evidenceTest(
    'shutdown with every slot busy still drains inside its budget instead of waiting for a handler',
    async () => {
      const jobs = [await seed(), await seed()];
      for (const job of jobs) await queues.queues.jobs.send(job.body);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = 0;
      const consumer = makeConsumer(
        registry(async (ctx) => {
          started += 1;
          await gate;
          await writeEffect(ctx);
        }),
        { concurrency: 2, drainTimeoutMs: 300 },
      );
      consumer.start();
      await until(() => Promise.resolve(started === 2));
      const begun = Date.now();
      expect(await consumer.stop()).toEqual({ abandoned: 2 });
      expect(Date.now() - begun).toBeLessThan(3_000);
      release();
    },
  );

  evidenceTest('a handler past its deadline frees its slot and is never acknowledged', async () => {
    const stuck = await seed();
    const next = await seed();
    await queues.queues.jobs.send(stuck.body);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    makeConsumer(
      registry(async (ctx) => {
        if (ctx.job.id === stuck.envelope.jobId) await gate;
        await writeEffect(ctx);
      }),
      { concurrency: 1, handlerDeadlineSeconds: 1 },
    ).start();
    await until(() => Promise.resolve(logLines.some((l) => l.includes('handler deadline'))));
    // The only slot is free again: a second job runs while the first transaction is still open.
    await queues.queues.jobs.send(next.body);
    await until(async () => (await ledger(next.envelope.jobId))?.status === 'succeeded');
    expect((await queues.counts('jobs')).visible + (await queues.counts('jobs')).leased).toBe(1);
    release();
  });

  evidenceTest(
    'a job whose transaction keeps dying is dead-lettered by the receive ceiling',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      makeConsumer(
        registry(async (ctx) => {
          await ctx.client.query('select pg_terminate_backend(pg_backend_pid())');
        }),
        { receiveCeilingFactor: 1 },
      ).start();
      const dead = await receiveOne(queues.queues.deadLetter, 30);
      expect(dead?.attributes['reason']).toBe('max-receive-exceeded');
      expect(await ledger(job.envelope.jobId)).toMatchObject({
        status: 'dead',
        error_code: 'max-receive-exceeded',
      });
    },
  );

  // The ceiling path changes ledger state, so it checks the envelope against the row exactly as
  // execution does. Five receives put the next delivery above the ceiling of every seeded type.
  const IDENTITY_MISMATCHES: readonly {
    readonly name: string;
    readonly forge: (envelope: JobEnvelope) => JobEnvelope;
  }[] = [
    { name: 'correlation id', forge: (e) => ({ ...e, correlationId: uuidv7() }) },
    { name: 'type', forge: (e) => ({ ...e, type: 'postcall-finalise' }) },
    { name: 'version', forge: (e) => ({ ...e, version: 2 }) },
  ];
  for (const { name, forge } of IDENTITY_MISMATCHES) {
    evidenceTest(
      `a delivery past the receive ceiling with the wrong ${name} is rejected and changes nothing`,
      async () => {
        const job = await seed();
        await queues.queues.jobs.send(JSON.stringify(forge(job.envelope)));
        for (let i = 0; i < 5; i += 1) {
          const message = await receiveOne(queues.queues.jobs);
          if (message === undefined) throw new Error('priming delivery missing');
          await queues.queues.jobs.hide(message, 0);
        }
        let calls = 0;
        const count: JobHandler = () => {
          calls += 1;
          return Promise.resolve();
        };
        makeConsumer(
          new JobHandlerRegistry()
            .register('sweep-run', 1, count)
            .register('sweep-run', 2, count)
            .register('postcall-finalise', 1, count),
          { receiveCeilingFactor: 1 },
        ).start();
        const rejected = await receiveOne(queues.queues.deadLetter, 30);
        expect(rejected?.attributes['reason']).toBe('job-mismatch');
        expect(calls).toBe(0);
        expect(await ledger(job.envelope.jobId)).toEqual({
          status: 'queued',
          attempt: 0,
          error_code: null,
        });
      },
    );
  }

  evidenceTest(
    'a delivery past the receive ceiling for a row another transaction holds is kept, then settles',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      // Three receives put the next delivery above the ceiling of 3 (sweep-run × factor 1).
      for (let i = 0; i < 3; i += 1) {
        const message = await receiveOne(queues.queues.jobs);
        if (message === undefined) throw new Error('priming delivery missing');
        await queues.queues.jobs.hide(message, 0);
      }
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = false;
      // A live transaction holds the row and then rolls back: the job is still open afterwards.
      const holder = withTenant(app, ORG_A, async (client) => {
        await client.query(`select 1 from job_runs where id = $1 for update`, [job.envelope.jobId]);
        holding = true;
        await gate;
        throw new Error('holder rolls back');
      }).catch(() => undefined);
      await until(() => Promise.resolve(holding));
      makeConsumer(registry(writeEffect), { receiveCeilingFactor: 1 }).start();
      await until(() => Promise.resolve(logLines.some((l) => l.includes('max-receive-busy'))));
      // Several redeliveries cross the ceiling while the lock is held; none may be acknowledged.
      await sleep(VISIBILITY_S * 1000);
      expect(await queues.counts('deadLetter')).toEqual({ visible: 0, leased: 0 });
      const held = await queues.counts('jobs');
      expect(held.visible + held.leased).toBe(1);
      expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'queued', attempt: 0 });

      release();
      await holder;
      const dead = await receiveOne(queues.queues.deadLetter, 30);
      expect(dead?.attributes['reason']).toBe('max-receive-exceeded');
      expect(await ledger(job.envelope.jobId)).toMatchObject({
        status: 'dead',
        error_code: 'max-receive-exceeded',
      });
      await sleep(VISIBILITY_S * 1000 + 500);
      expect(await queues.counts('jobs')).toEqual({ visible: 0, leased: 0 });
    },
  );

  evidenceTest(
    'a delivery past the receive ceiling for a job that already succeeded is deleted, not dead-lettered',
    async () => {
      const job = await seed();
      await admin.query(
        `update job_runs set status = 'succeeded', attempt = 1, finished_at = now() where id = $1`,
        [job.envelope.jobId],
      );
      await queues.queues.jobs.send(job.body);
      for (let i = 0; i < 3; i += 1) {
        const message = await receiveOne(queues.queues.jobs);
        if (message === undefined) throw new Error('priming delivery missing');
        await queues.queues.jobs.hide(message, 0);
      }
      makeConsumer(registry(writeEffect), { receiveCeilingFactor: 1 }).start();
      await until(async () => {
        const counts = await queues.counts('jobs');
        return counts.visible + counts.leased === 0;
      });
      expect(await queues.counts('deadLetter')).toEqual({ visible: 0, leased: 0 });
      expect(await ledger(job.envelope.jobId)).toMatchObject({ status: 'succeeded', attempt: 1 });
      expect(await effects(job.envelope.jobId)).toBe(0);
    },
  );

  evidenceTest('logs and ledger carry ids and codes, never payload or error text', async () => {
    const job = await seed();
    await queues.queues.jobs.send(job.body);
    makeConsumer(registry(() => Promise.reject(new Error(`provider said ${SENTINEL}`)))).start();
    await until(async () => (await ledger(job.envelope.jobId))?.error_code === 'handler-error');
    await sleep(300);
    const text = logLines.join('\n');
    expect(text).toContain(job.envelope.jobId);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(job.envelope.payload['taskId']);
  });
  evidenceTest(
    'a job another worker is running right now is left on the queue, and survives that worker dying',
    async () => {
      const job = await seed();
      await queues.queues.jobs.send(job.body);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding = false;
      // A competing worker holds the job row lock, then dies without finishing.
      const rival = withTenant(app, ORG_A, async (client) => {
        await client.query(`select 1 from job_runs where id = $1 for update`, [job.envelope.jobId]);
        holding = true;
        await gate;
        throw new Error('rival worker crashed');
      }).catch(() => undefined);
      await until(() => Promise.resolve(holding));
      let runs = 0;
      makeConsumer(
        registry(async (ctx) => {
          runs += 1;
          await writeEffect(ctx);
        }),
      ).start();
      await sleep(1500);
      expect(runs).toBe(0);
      expect(await queues.counts('jobs')).toMatchObject({ visible: 0 });
      expect((await queues.counts('jobs')).visible + (await queues.counts('jobs')).leased).toBe(1);
      release();
      await rival;
      await until(async () => (await ledger(job.envelope.jobId))?.status === 'succeeded');
      expect(runs).toBe(1);
      expect(await effects(job.envelope.jobId)).toBe(1);
    },
  );
});
