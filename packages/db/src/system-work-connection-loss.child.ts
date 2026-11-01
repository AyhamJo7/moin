/**
 * Child process for `system-work-connection-loss.integration.test.ts`.
 *
 * It runs in its own process because the failure it guards against is the process ending: an
 * unhandled 'error' event on a checked-out client is fatal to Node, which a test runner would
 * report as its own failure instead of as the behaviour under test. The application role kills its
 * own backend, so no privileged role is involved.
 *
 *   SYSTEM_WORK_APP_URL=postgres://… node system-work-connection-loss.child.ts
 */
import { createPool } from './pool.ts';
import { withSystemWork } from './tenant.ts';

const say = (...parts: readonly unknown[]): void => {
  process.stdout.write(`${parts.map(String).join(' ')}\n`);
};

const url = process.env['SYSTEM_WORK_APP_URL'];
if (url === undefined || url === '') throw new Error('SYSTEM_WORK_APP_URL is not set');

const pool = createPool({ connectionString: url, max: 1 });
try {
  const role = await pool.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
    'select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
  );
  say('CHILD_ROLE', JSON.stringify(role.rows[0]));
  try {
    await withSystemWork(
      pool,
      async (client) => {
        await client.query('select pg_terminate_backend(pg_backend_pid())');
        return [];
      },
      () => Promise.resolve(),
    );
    say('CHILD_CLAIM_RESOLVED');
  } catch (error) {
    say('CHILD_CLAIM_REJECTED', (error as { code?: string }).code ?? 'error');
  }
  // Give a late 'error' event on the dead client time to arrive.
  await new Promise((resolve) => setTimeout(resolve, 250));
  say('CHILD_POOL_TOTAL', pool.totalCount);
  await pool.query('select 1');
  say('CHILD_FRESH_QUERY_OK');
} finally {
  await pool.end();
}
