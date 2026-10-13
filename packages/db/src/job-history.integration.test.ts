/**
 * Job history + replay tooling (P08.06.01–.03): terminal writes, DLQ listing
 * metadata-only, idempotent replay, audited discard. Synthetic only (INV-16).
 */
import { uuidv7 } from '@moin/kernel';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  discardJob,
  finishJob,
  inspectJob,
  listDeadJobs,
  replayJob,
} from './job-history.ts';
import { claimJob, enqueueJob } from './jobs.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('job-history');
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

async function deadJob(): Promise<string> {
  const job = await withTenant(app, ORG_A, (client) =>
    enqueueJob(client, { jobId: uuidv7(), type: 'sweep-run', correlationId: uuidv7() }),
  );
  const claimed = await withTenant(app, ORG_A, (client) =>
    claimJob(client, { queue: job.queue, type: 'sweep-run' }),
  );
  if (claimed === null || claimed.id !== job.id) throw new Error('claim missed its own row');
  await withTenant(app, ORG_A, (client) =>
    finishJob(client, job.id, { state: 'dead', errorCode: 'handler-crash' }),
  );
  return job.id;
}

describe('job-history', () => {
  evidenceTest('terminal writes record durations; DLQ lists metadata only', async () => {
    const id = await deadJob();
    const dead = await withTenant(app, ORG_A, (client) => listDeadJobs(client));
    expect(dead.map((d) => d.id)).toContain(id);
    const row = dead.find((d) => d.id === id);
    expect(row?.errorCode).toBe('handler-crash');
    expect(row?.finishedAt).not.toBeNull();
    // Metadata only: no payload key on the list rows.
    expect('payload' in (row as object)).toBe(false);
    // Tenant B never sees tenant A's DLQ.
    const foreign = await withTenant(app, ORG_B, (client) => listDeadJobs(client));
    expect(foreign.map((d) => d.id)).not.toContain(id);
    // Full envelope on inspect (operator chose the row).
    const detail = await withTenant(app, ORG_A, (client) => inspectJob(client, id));
    expect(detail?.status).toBe('dead');
    expect(detail?.attempt).toBe(1);
  });

  evidenceTest('replayed job is idempotent; double replay is a no-op', async () => {
    const id = await deadJob();
    expect(await withTenant(app, ORG_A, (client) => replayJob(client, id))).toBe(true);
    const detail = await withTenant(app, ORG_A, (client) => inspectJob(client, id));
    expect(detail?.status).toBe('queued');
    expect(detail?.attempt).toBe(1);
    // Second replay finds no dead row — no duplicate enqueue.
    expect(await withTenant(app, ORG_A, (client) => replayJob(client, id))).toBe(false);
    // And the replayed row is claimable again (same attempt+1 path).
    const reclaimed = await withTenant(app, ORG_A, (client) =>
      claimJob(client, { queue: 'sweeps', type: 'sweep-run' }),
    );
    expect(reclaimed?.id).toBe(id);
    expect(reclaimed?.attempt).toBe(2);
  });

  evidenceTest('discard requires a reason and is audited', async () => {
    const id = await deadJob();
    await expect(
      withTenant(app, ORG_A, (client) => discardJob(client, id, 'short')),
    ).rejects.toBeInstanceOf(RangeError);
    expect(await withTenant(app, ORG_A, (client) => discardJob(client, id, 'superseded by rerun'))).toBe(
      true,
    );
    const events = await withTenant(app, ORG_A, (client) =>
      listAuditEvents(client, { targetId: id }),
    );
    expect(events.map((e) => e.target_id)).toContain(id);
    // Discarding a non-dead row is a no-op, never an error.
    const live = await withTenant(app, ORG_A, (client) =>
      enqueueJob(client, { jobId: uuidv7(), type: 'sweep-run', correlationId: uuidv7() }),
    );
    expect(
      await withTenant(app, ORG_A, (client) => discardJob(client, live.id, 'not dead yet here')),
    ).toBe(false);
  });
});
