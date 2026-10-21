/**
 * Job execution against real PostgreSQL as `moin_app` (P08.05, ADR-0008, INV-01, INV-11, INV-19).
 * Synthetic data only (INV-16). The effect table is a test-only tenant table with FORCE RLS, so
 * "one durable effect" and "no cross-tenant read" are observed in the database, not in memory.
 */
import { JobFailure, uuidv7 } from '@moin/kernel';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { abandonJob, executeJob, MAX_DEFER_SECONDS, type JobHandler } from './job-execution.ts';
import { enqueueJob } from './jobs.ts';
import { createPool, type Pool } from './pool.ts';
import { TenantContextError, withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const SECRET_SENTINEL = 'caller-Maria-Schmidt-+4930123456';
const RANDOM_MID = (): number => 0.5;

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('job-execution');
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
      note text not null default 'effect'
    );
    create unique index job_effects_one_per_job on job_effects (organisation_id, job_id);
    alter table job_effects enable row level security;
    alter table job_effects force row level security;
    create policy job_effects_tenant on job_effects
      using (organisation_id = app.current_org()) with check (organisation_id = app.current_org());
    grant select, insert on job_effects to moin_app;
  `);
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

async function newJob(org = ORG_A, type: 'sweep-run' | 'postcall-finalise' = 'sweep-run') {
  const jobId = uuidv7();
  const correlationId = uuidv7();
  await withTenant(app, org, (client) =>
    enqueueJob(client, { jobId, type, correlationId, payload: { taskId: uuidv7() } }),
  );
  return { jobId, correlationId, type };
}

function request(
  job: { jobId: string; correlationId: string; type: 'sweep-run' | 'postcall-finalise' },
  handler: JobHandler,
  org = ORG_A,
) {
  return {
    jobId: job.jobId,
    organisationId: org,
    type: job.type,
    version: 1,
    correlationId: job.correlationId,
    handler,
    random: RANDOM_MID,
  };
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
  const res = await admin.query<{
    status: string;
    attempt: number;
    error_code: string | null;
    finished_at: Date | null;
    not_before: Date | null;
  }>(`select status, attempt, error_code, finished_at, not_before from job_runs where id = $1`, [
    jobId,
  ]);
  return res.rows[0];
}

describe('executeJob', () => {
  evidenceTest(
    'a valid job runs the handler once and commits effect and success together',
    async () => {
      const job = await newJob();
      const result = await executeJob(app, request(job, writeEffect));
      expect(result).toEqual({ kind: 'succeeded' });
      expect(await effects(job.jobId)).toBe(1);
      expect(await ledger(job.jobId)).toMatchObject({ status: 'succeeded', attempt: 1 });
    },
  );

  evidenceTest('a duplicate delivery does not repeat the effect', async () => {
    const job = await newJob();
    await executeJob(app, request(job, writeEffect));
    let calls = 0;
    const second = await executeJob(
      app,
      request(job, () => {
        calls += 1;
        return Promise.resolve();
      }),
    );
    expect(second).toEqual({ kind: 'duplicate' });
    expect(calls).toBe(0);
    expect(await effects(job.jobId)).toBe(1);
    expect((await ledger(job.jobId))?.attempt).toBe(1);
  });

  evidenceTest(
    'workers racing on one job produce one effect; the rest see busy or duplicate',
    async () => {
      const job = await newJob();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered: () => void = () => undefined;
      const inside = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const first = executeJob(
        app,
        request(job, async (ctx) => {
          entered();
          await gate;
          await writeEffect(ctx);
        }),
      );
      await inside;
      const racers = await Promise.all(
        Array.from({ length: 8 }, () => executeJob(app, request(job, writeEffect))),
      );
      expect(racers.every((r) => r.kind === 'busy')).toBe(true);
      release();
      expect(await first).toEqual({ kind: 'succeeded' });
      const late = await executeJob(app, request(job, writeEffect));
      expect(late).toEqual({ kind: 'duplicate' });
      expect(await effects(job.jobId)).toBe(1);
    },
  );

  evidenceTest(
    'a transient failure rolls back the handler, keeps the claim and schedules a retry',
    async () => {
      const job = await newJob();
      const result = await executeJob(
        app,
        request(job, async (ctx) => {
          await writeEffect(ctx);
          throw new Error(`boom ${SECRET_SENTINEL}`);
        }),
      );
      expect(result).toEqual({ kind: 'retry', delaySeconds: 30, errorCode: 'handler-error' });
      expect(await effects(job.jobId)).toBe(0);
      const row = await ledger(job.jobId);
      expect(row).toMatchObject({ status: 'queued', attempt: 1, error_code: 'handler-error' });
      expect(JSON.stringify(row)).not.toContain(SECRET_SENTINEL);
      // The retry is not due yet: an early redelivery is deferred, not executed.
      let calls = 0;
      const early = await executeJob(
        app,
        request(job, () => {
          calls += 1;
          return Promise.resolve();
        }),
      );
      expect(early.kind).toBe('deferred');
      expect(calls).toBe(0);
      if (early.kind === 'deferred') {
        expect(early.seconds).toBeGreaterThan(0);
        expect(early.seconds).toBeLessThanOrEqual(MAX_DEFER_SECONDS);
      }
    },
  );

  evidenceTest(
    'transient failures exhaust the attempts and end dead, with a safe code',
    async () => {
      const job = await newJob();
      const outcomes: string[] = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await admin.query(`update job_runs set not_before = null where id = $1`, [job.jobId]);
        const result = await executeJob(
          app,
          request(job, () => Promise.reject(new JobFailure('provider-timeout'))),
        );
        outcomes.push(result.kind);
      }
      expect(outcomes).toEqual(['retry', 'retry', 'dead']);
      expect(await ledger(job.jobId)).toMatchObject({
        status: 'dead',
        attempt: 3,
        error_code: 'provider-timeout',
      });
      expect((await ledger(job.jobId))?.finished_at).not.toBeNull();
    },
  );

  evidenceTest('a permanent failure and a schema error go dead at once', async () => {
    const permanent = await newJob();
    expect(
      await executeJob(
        app,
        request(permanent, () => Promise.reject(new JobFailure('unsupported-shape', true))),
      ),
    ).toEqual({ kind: 'dead', errorCode: 'unsupported-shape', alreadyDead: false });
    const invalid = await newJob();
    expect(
      await executeJob(
        app,
        request(invalid, () => Promise.reject(new RangeError('bad payload'))),
      ),
    ).toEqual({ kind: 'dead', errorCode: 'payload-invalid', alreadyDead: false });
    // Redelivery of a dead job runs nothing and asks for the DLQ copy again.
    expect(await executeJob(app, request(invalid, writeEffect))).toEqual({
      kind: 'dead',
      errorCode: 'already-dead',
      alreadyDead: true,
    });
    expect(await effects(invalid.jobId)).toBe(0);
  });

  evidenceTest(
    'a crash before the commit leaves no effect and the redelivery runs cleanly',
    async () => {
      const job = await newJob();
      await expect(
        executeJob(
          app,
          request(job, async (ctx) => {
            await writeEffect(ctx);
            await ctx.client.query('select pg_terminate_backend(pg_backend_pid())');
          }),
        ),
      ).rejects.toThrow();
      expect(await effects(job.jobId)).toBe(0);
      expect(await ledger(job.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
      expect(await executeJob(app, request(job, writeEffect))).toEqual({ kind: 'succeeded' });
      expect(await effects(job.jobId)).toBe(1);
    },
  );

  evidenceTest('a worker that dies mid-job leaves a claimable row, never a stuck one', async () => {
    const job = await newJob();
    await admin.query(
      `update job_runs set status = 'claimed', claimed_at = now(), attempt = 1 where id = $1`,
      [job.jobId],
    );
    expect(await executeJob(app, request(job, writeEffect))).toEqual({ kind: 'succeeded' });
    expect(await ledger(job.jobId)).toMatchObject({ status: 'succeeded', attempt: 2 });
    expect(await effects(job.jobId)).toBe(1);
  });

  evidenceTest(
    'tenant context fails closed: bad id, other tenant, forged envelope fields',
    async () => {
      const job = await newJob(ORG_A);
      let calls = 0;
      const spy: JobHandler = () => {
        calls += 1;
        return Promise.resolve();
      };
      await expect(executeJob(app, request(job, spy, 'not-a-uuid'))).rejects.toBeInstanceOf(
        TenantContextError,
      );
      expect(await executeJob(app, request(job, spy, ORG_B))).toEqual({ kind: 'unknown' });
      expect(await executeJob(app, { ...request(job, spy), correlationId: uuidv7() })).toEqual({
        kind: 'mismatch',
      });
      expect(await executeJob(app, { ...request(job, spy), type: 'postcall-finalise' })).toEqual({
        kind: 'mismatch',
      });
      expect(calls).toBe(0);
      expect(await ledger(job.jobId)).toMatchObject({ status: 'queued', attempt: 0 });
    },
  );

  evidenceTest('one tenant cannot read another tenant’s effect from inside a handler', async () => {
    const jobA = await newJob(ORG_A);
    await executeJob(app, request(jobA, writeEffect));
    const jobB = await newJob(ORG_B);
    let visible = -1;
    await executeJob(
      app,
      request(
        jobB,
        async ({ client }) => {
          const res = await client.query(`select 1 from job_effects where job_id = $1`, [
            jobA.jobId,
          ]);
          visible = res.rows.length;
          const cross = await client.query(`select 1 from job_runs where id = $1`, [jobA.jobId]);
          visible += cross.rows.length;
        },
        ORG_B,
      ),
    );
    expect(visible).toBe(0);
  });

  evidenceTest('a job scheduled for later is deferred, not run', async () => {
    const job = await newJob();
    await admin.query(`update job_runs set not_before = now() + interval '2 hours' where id = $1`, [
      job.jobId,
    ]);
    const result = await executeJob(app, request(job, writeEffect));
    expect(result.kind).toBe('deferred');
    expect(await effects(job.jobId)).toBe(0);
    expect((await ledger(job.jobId))?.attempt).toBe(0);
  });
  evidenceTest(
    'an upper-case correlation id in the envelope still matches the ledger',
    async () => {
      const job = await newJob();
      const result = await executeJob(app, {
        ...request(job, writeEffect),
        correlationId: job.correlationId.toUpperCase(),
      });
      expect(result).toEqual({ kind: 'succeeded' });
    },
  );

  evidenceTest('a success clears the error code an earlier failed attempt left', async () => {
    const job = await newJob();
    await executeJob(
      app,
      request(job, () => Promise.reject(new Error('first try fails'))),
    );
    expect((await ledger(job.jobId))?.error_code).toBe('handler-error');
    await admin.query(`update job_runs set not_before = null where id = $1`, [job.jobId]);
    expect(await executeJob(app, request(job, writeEffect))).toEqual({ kind: 'succeeded' });
    expect((await ledger(job.jobId))?.error_code).toBeNull();
  });

  evidenceTest(
    'abandonJob ends an open job, spares a finished one and skips a locked one',
    async () => {
      const open = await newJob();
      expect(await abandonJob(app, ORG_A, open.jobId, 'max-receive-exceeded')).toBe(true);
      expect(await ledger(open.jobId)).toMatchObject({
        status: 'dead',
        error_code: 'max-receive-exceeded',
      });
      const done = await newJob();
      await executeJob(app, request(done, writeEffect));
      expect(await abandonJob(app, ORG_A, done.jobId, 'max-receive-exceeded')).toBe(false);
      expect((await ledger(done.jobId))?.status).toBe('succeeded');
      expect(await abandonJob(app, ORG_B, open.jobId, 'max-receive-exceeded')).toBe(false);
      const held = await newJob();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const state: { holding: boolean } = { holding: false };
      const holder = withTenant(app, ORG_A, async (client) => {
        await client.query(`select 1 from job_runs where id = $1 for update`, [held.jobId]);
        state.holding = true;
        await gate;
      });
      while (!state.holding) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await abandonJob(app, ORG_A, held.jobId, 'max-receive-exceeded')).toBe(false);
      release();
      await holder;
      expect((await ledger(held.jobId))?.status).toBe('queued');
    },
  );
});
