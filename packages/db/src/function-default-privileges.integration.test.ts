/**
 * A function the migration role creates is not callable until it is granted (P06.01.02, INV-01).
 *
 * 0003 scoped its REVOKE to the `public` and `app` schemas, which does not remove PostgreSQL's
 * built-in grant of EXECUTE to PUBLIC; 0078 removes it for everything the migrator creates. Each
 * function here is created by the real `moin_migrator` and called by the real `moin_app`.
 */
import { createPool, type Pool } from './pool.ts';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';

let database: TestDatabase;
let migrator: Pool;

beforeAll(async () => {
  database = await createTestDatabase('function-default-privileges');
  const base = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (base === undefined || base.length === 0) {
    throw new Error('TEST_DATABASE_MIGRATOR_URL is not set; it is in .env.example.');
  }
  const url = new URL(base);
  url.pathname = `/${database.name}`;
  migrator = createPool({ connectionString: url.toString(), max: 1 });
});

afterAll(async () => {
  await migrator.end();
  await database.drop();
});

describe('functions created by the migration role', () => {
  for (const schema of ['app', 'public'] as const) {
    evidenceTest(
      `a new function in ${schema} is not executable by moin_app until it is granted`,
      async () => {
        const name = `${schema}.sec04_probe_${schema}`;
        /* eslint-disable no-restricted-syntax -- DDL cannot be parameterised; schema and name are literals of this file. */
        await migrator.query(
          `CREATE FUNCTION ${name}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
        );
        try {
          await expect(database.pool().query(`SELECT ${name}()`)).rejects.toMatchObject({
            code: '42501',
          });
          await migrator.query(`GRANT EXECUTE ON FUNCTION ${name}() TO moin_app`);
          const granted = await database.pool().query<{ one: number }>(`SELECT ${name}() AS one`);
          expect(granted.rows[0]?.one).toBe(1);
        } finally {
          await migrator.query(`DROP FUNCTION ${name}()`);
        }
        /* eslint-enable no-restricted-syntax */
      },
    );
  }

  evidenceTest('the application role still evaluates the tenant policy helper', async () => {
    const res = await database
      .pool()
      .query<{ org: string | null }>(`SELECT app.current_org() AS org`);
    expect(res.rows[0]?.org).toBeNull();
  });
});
