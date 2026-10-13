/**
 * Job envelope ledger (P08.01.01–.03): enqueue validation, ID-only payload,
 * guarded claims, tenant isolation. Synthetic data only (INV-16).
 */
import { uuidv7 } from '@moin/kernel';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { JobConflictError, claimJob, enqueueJob } from './jobs.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('jobs');
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

describe('jobs', () => {
  evidenceTest('enqueue validates envelope and payload is ID-only', async () => {
    const job = await withTenant(app, ORG_A, (client) =>
      enqueueJob(client, {
        jobId: uuidv7(),
        type: 'sweep-run',
        correlationId: uuidv7(),
        payload: { taskId: ORG_A },
      }),
    );
    expect(job.queue).toBe('sweeps');
    expect(job.status).toBe('queued');
    // Unknown type refused at the TS boundary; content payload refused at lint.
    await expect(
      withTenant(app, ORG_A, (client) =>
        enqueueJob(client, {
          jobId: uuidv7(),
          type: 'send-everything' as never,
          correlationId: uuidv7(),
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        enqueueJob(client, {
          jobId: uuidv7(),
          type: 'sweep-run',
          correlationId: uuidv7(),
          payload: { note: 'call back soon' },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Duplicate jobId is a 409, never a double enqueue.
    const dup = uuidv7();
    await withTenant(app, ORG_A, (client) =>
      enqueueJob(client, { jobId: dup, type: 'sweep-run', correlationId: uuidv7() }),
    );
    await expect(
      withTenant(app, ORG_A, (client) =>
        enqueueJob(client, { jobId: dup, type: 'sweep-run', correlationId: uuidv7() }),
      ),
    ).rejects.toBeInstanceOf(JobConflictError);
  });

  evidenceTest('claims are guarded, due-only, tenant-isolated', async () => {
    // Narrow every claim to one type: the sweeps queue is shared, so an
    // unfiltered claim could take any earlier row in file order.
    const first = await withTenant(app, ORG_A, (client) =>
      enqueueJob(client, { jobId: uuidv7(), type: 'reverify-sweep', correlationId: uuidv7() }),
    );
    // Future not_before is not claimable.
    await withTenant(app, ORG_A, (client) =>
      enqueueJob(client, {
        jobId: uuidv7(),
        type: 'retention-purge',
        correlationId: uuidv7(),
        notBefore: new Date(Date.now() + 3_600_000),
      }),
    );
    const claimed = await withTenant(app, ORG_A, (client) =>
      claimJob(client, { queue: 'sweeps', type: 'reverify-sweep' }),
    );
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.attempt).toBe(1);
    // Second claim finds the future-dated row not due → null.
    expect(
      await withTenant(app, ORG_A, (client) =>
        claimJob(client, { queue: 'sweeps', type: 'reverify-sweep' }),
      ),
    ).toBeNull();
    // Tenant B never sees tenant A's queue.
    expect(await withTenant(app, ORG_B, (client) => claimJob(client, { queue: 'sweeps' }))).toBeNull();
  });
});
