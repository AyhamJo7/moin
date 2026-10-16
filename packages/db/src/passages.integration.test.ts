/**
 * Approved passages (P09.09.04 SELL): idempotent re-embed + tenant isolation.
 * Synthetic (INV-16). Retrieval gating rides P09.09 view + RLS.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { passagesForVersion, storePassage } from './passages.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('passages');
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

describe('passages', () => {
  evidenceTest('re-embed is idempotent per version+chunk', async () => {
    const versionId = randomUUID();
    const first = await withTenant(app, ORG_A, (client) =>
      storePassage(client, {
        versionId,
        chunkIndex: 0,
        content: 'first',
        embeddingModel: 'm1',
      }),
    );
    const second = await withTenant(app, ORG_A, (client) =>
      storePassage(client, {
        versionId,
        chunkIndex: 0,
        content: 'second',
        embeddingModel: 'm1',
      }),
    );
    expect(second).toBe(first);
    const rows = await withTenant(app, ORG_A, (client) => passagesForVersion(client, versionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('second');
  });

  evidenceTest('version mismatch + cross-tenant never surface', async () => {
    const versionId = randomUUID();
    await withTenant(app, ORG_A, (client) =>
      storePassage(client, {
        versionId,
        chunkIndex: 0,
        content: 'a',
        embeddingModel: 'm1',
      }),
    );
    const other = await withTenant(app, ORG_B, (client) => passagesForVersion(client, versionId));
    expect(other).toEqual([]);
    const wrong = await withTenant(app, ORG_A, (client) =>
      passagesForVersion(client, randomUUID()),
    );
    expect(wrong).toEqual([]);
  });
});
