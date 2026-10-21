/**
 * A connection killed inside `withTenant` (failover, `pg_terminate_backend`) must surface as the
 * rejected query only: it must not become an uncaught exception that ends a long-running worker
 * (P08.05), and the dead connection must not go back into the pool.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG = '11111111-1111-4111-8111-111111111111';

let database: TestDatabase;
let app: Pool;

beforeAll(async () => {
  database = await createTestDatabase('tenant-connection-loss');
  app = database.pool();
});

afterAll(async () => {
  await database.drop();
});

describe('withTenant when the connection dies', () => {
  evidenceTest(
    'rejects with the query error, raises nothing uncaught and discards the connection',
    async () => {
      const uncaught: unknown[] = [];
      const record = (error: unknown): void => {
        uncaught.push(error);
      };
      process.on('uncaughtException', record);
      try {
        await expect(
          withTenant(app, ORG, async (client) => {
            await client.query('select pg_terminate_backend(pg_backend_pid())');
          }),
        ).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 200));
      } finally {
        process.off('uncaughtException', record);
      }
      expect(uncaught).toEqual([]);
      expect(app.totalCount).toBe(0);
      // The pool still works: the next unit of work gets a fresh connection.
      await expect(
        withTenant(app, ORG, (client) => client.query('select 1')),
      ).resolves.toBeDefined();
    },
  );
});
