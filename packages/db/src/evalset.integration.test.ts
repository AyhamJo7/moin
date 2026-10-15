/**
 * Knowledge eval set (P09.11.01/02): synthetic Musterrestaurant + fictional
 * Gurlitt-shaped variant — question variants select the right card (LG-V06),
 * off-catalogue + near-miss abstain or select-right (LG-V07). INV-16.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { evalQuestions, runEvalSet, seedEvalSet } from './evalset.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('evalset');
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

describe('evalset', () => {
  evidenceTest('variants select the right card, off-catalogue abstains', async () => {
    const ids = await withTenant(app, ORG_A, (client) => seedEvalSet(client));
    expect(Object.keys(ids)).toHaveLength(8);
    const report = await withTenant(app, ORG_A, (client) => runEvalSet(client, ids));
    expect(report.failures).toEqual([]);
    const variants = evalQuestions().filter((q) => q.kind === 'variant');
    expect(report.correctSelection).toBeGreaterThanOrEqual(variants.length - 1);
    // Every off-catalogue question must abstain (LG-V07 signal).
    const offCatalogue = evalQuestions().filter((q) => q.kind === 'off-catalogue');
    expect(report.abstentionOpportunities).toBeGreaterThanOrEqual(offCatalogue.length);
    expect(report.correctAbstention).toBe(report.abstentionOpportunities);
  });

  evidenceTest('eval corpus is tenant-isolated', async () => {
    const ids = await withTenant(app, ORG_A, (client) => seedEvalSet(client));
    const foreign = await withTenant(app, ORG_B, (client) => runEvalSet(client, ids));
    expect(foreign.correctSelection).toBe(0);
    expect(foreign.correctAbstention).toBe(foreign.abstentionOpportunities);
  });
});
