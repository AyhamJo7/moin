/**
 * The real worker executable (`apps/server/dist/main-worker.js`, as the release image starts it)
 * against real PostgreSQL and a real SQS-compatible emulator (P08.05, INV-17, INV-19).
 *
 * No production job type has a handler yet, so the processing proof is the unregistered-handler
 * path: the process receives a contracted job through the queue, resolves the tenant, claims the
 * job in the ledger and records a transient failure. That proves the worker infrastructure, not a
 * production callback-to-outbox pipeline. Needs the compiled output (`pnpm turbo run build
 * --filter=@moin/server...`); a missing build fails the test rather than skipping it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { createPool, type Pool } from '@moin/db/pool';
import { enqueueJob, withTenant } from '@moin/db';
import { uuidv7, type JobEnvelope } from '@moin/kernel';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect } from 'vitest';
import {
  createTestQueues,
  TEST_REGION,
  type TestQueues,
} from './modules/platform/test-support/sqs-queues.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const ENTRY = path.resolve(import.meta.dirname, '../dist/main-worker.js');

let database: TestDatabase;
let admin: Pool;
let queues: TestQueues;
let child: ChildProcess | undefined;
let output = '';

beforeAll(async () => {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `${ENTRY} is missing: run \`pnpm turbo run build --filter=@moin/server...\` first`,
    );
  }
  database = await createTestDatabase('main-worker');
  admin = createPool({ connectionString: database.migrationUrl, max: 2 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH')`,
    [ORG],
  );
});

beforeEach(async () => {
  queues = await createTestQueues('worker-proc', 2);
  output = '';
});

afterEach(async () => {
  child?.kill('SIGKILL');
  child = undefined;
  await queues.drop();
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

async function startWorker(extra: Record<string, string> = {}): Promise<ChildProcess> {
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    NODE_ENV: 'test',
    SERVER_ROLE: 'worker',
    PORT: String(await freePort()),
    LOG_LEVEL: 'info',
    DATABASE_URL: database.appUrl,
    SQS_REGION: TEST_REGION,
    SQS_ENDPOINT: queues.endpoint,
    SQS_QUEUE_JOBS: queues.name,
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    JOB_POLL_WAIT_SECONDS: '1',
    JOB_VISIBILITY_SECONDS: '10',
    DRAIN_MS: '0',
    SHUTDOWN_GRACE_MS: '5000',
    ...extra,
  };
  const proc = spawn(process.execPath, [ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  proc.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child = proc;
  return proc;
}

const exited = (proc: ChildProcess): Promise<number | null> =>
  new Promise((resolve) => {
    if (proc.exitCode !== null) resolve(proc.exitCode);
    else
      proc.once('exit', (code) => {
        resolve(code);
      });
  });

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition not reached in time; process output:\n${output}`);
}

async function seedJob(): Promise<JobEnvelope> {
  const jobId = uuidv7();
  const correlationId = uuidv7();
  const payload = { taskId: uuidv7() };
  await withTenant(database.pool(), ORG, (client) =>
    enqueueJob(client, { jobId, type: 'sweep-run', correlationId, payload }),
  );
  return {
    jobId,
    type: 'sweep-run',
    version: 1,
    organisationId: ORG,
    correlationId,
    traceContext: null,
    attempt: 0,
    notBefore: null,
    payload,
  };
}

describe('worker process', () => {
  evidenceTest(
    'receives a contracted job through SQS, claims it in the ledger and records the outcome',
    async () => {
      const envelope = await seedJob();
      await startWorker();
      await queues.queues.jobs.send(JSON.stringify(envelope));
      await until(async () => {
        const row = await admin.query<{ error_code: string | null }>(
          `select error_code from job_runs where id = $1`,
          [envelope.jobId],
        );
        return row.rows[0]?.error_code === 'handler-unavailable';
      });
      const row = await admin.query(`select status, attempt from job_runs where id = $1`, [
        envelope.jobId,
      ]);
      expect(row.rows[0]).toMatchObject({ status: 'queued', attempt: 1 });
      expect(output).toContain(envelope.jobId);
    },
  );

  evidenceTest('dead-letters a schema-invalid message and leaves the process healthy', async () => {
    await startWorker();
    await queues.queues.jobs.send('{"type":"sweep-run"}');
    const [dead] = await queues.queues.deadLetter.receive({ max: 1, waitSeconds: 10 });
    expect(dead?.attributes['reason']).toBe('envelope-invalid');
    expect(child?.exitCode).toBeNull();
  });

  evidenceTest('SIGTERM stops polling and exits 0 within the grace period', async () => {
    const proc = await startWorker();
    await until(() => output.includes('listening'));
    proc.kill('SIGTERM');
    const code = await Promise.race([
      exited(proc),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => {
          resolve('timeout');
        }, 8_000),
      ),
    ]);
    expect(code).toBe(0);
    expect(output).toContain('job consumer stopped');
  });

  evidenceTest('refuses to start without a queue, naming the variables and no value', async () => {
    const proc = await startWorker({ SQS_QUEUE_JOBS: '' });
    const code = await exited(proc);
    expect(code).toBe(1);
    expect(output).toContain('SQS_QUEUE_JOBS');
  });
});
