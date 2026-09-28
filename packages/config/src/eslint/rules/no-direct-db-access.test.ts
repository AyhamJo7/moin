import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import { noDirectDbAccess } from './no-direct-db-access.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2024, sourceType: 'module' },
});

const inModule = 'apps/server/src/modules/work/application/list-tasks.ts';

ruleTester.run('no-direct-db-access', noDirectDbAccess, {
  valid: [
    {
      filename: inModule,
      code: 'await withTenant(organisationId, async (tx) => { await db.query(sqlText, params); });',
    },
    {
      filename: inModule,
      code: 'await withSystemWork(async () => { await pool.query(sqlText); });',
    },
    {
      filename: inModule,
      code: 'const rows = await taskRepository.listOpen(organisationId);',
    },
    // The wrapper and the test harness necessarily hold raw handles.
    { filename: 'packages/db/src/tenant.ts', code: 'await pool.query(sqlText);' },
    { filename: 'packages/testing/src/pg/template.ts', code: 'await client.query(sqlText);' },
  ],
  invalid: [
    {
      filename: inModule,
      code: 'const rows = await db.query("select * from tasks");',
      errors: [{ messageId: 'outsideWrapper', data: { handle: 'db', method: 'query' } }],
    },
    {
      filename: inModule,
      code: 'await pool.execute(statement);',
      errors: [{ messageId: 'outsideWrapper' }],
    },
    {
      filename: inModule,
      code: 'await client.transaction(async () => { doWork(); });',
      errors: [{ messageId: 'outsideWrapper' }],
    },
    {
      // Nesting inside an unrelated callback does not count as being wrapped.
      filename: inModule,
      code: 'items.forEach(async () => { await db.query(sqlText); });',
      errors: [{ messageId: 'outsideWrapper' }],
    },
  ],
});
