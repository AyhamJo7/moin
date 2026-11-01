/**
 * A connection lost inside the claim of `withSystemWork` must surface as the rejected claim only
 * (P06.14.01, SEC-G02 F1). Before the claim shared `withTenant`'s connection handling, a claim
 * that killed its own backend raised an unhandled 'error' event and ended the process that runs
 * the sweep.
 *
 * The scenario runs in a child process with the real `moin_app` pool (NOSUPERUSER, NOBYPASSRLS):
 * the failure is the process exiting, which cannot be asserted from inside the runner.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase('system-work-connection-loss');
});

afterAll(async () => {
  await database.drop();
});

describe('withSystemWork when the claim connection dies', () => {
  evidenceTest(
    'rejects the claim, raises nothing uncaught, discards the connection and the process exits 0',
    () => {
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./system-work-connection-loss.child.ts', import.meta.url))],
        {
          env: { PATH: process.env['PATH'] ?? '', SYSTEM_WORK_APP_URL: database.appUrl },
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      expect(child.stderr).not.toMatch(/Unhandled 'error' event|uncaught/iu);
      expect(child.stdout).toContain('"rolsuper":false');
      expect(child.stdout).toContain('"rolbypassrls":false');
      expect(child.stdout).toContain('CHILD_CLAIM_REJECTED');
      expect(child.stdout).not.toContain('CHILD_CLAIM_RESOLVED');
      // The dead client was not kept, and a fresh query works.
      expect(child.stdout).toContain('CHILD_POOL_TOTAL 0');
      expect(child.stdout).toContain('CHILD_FRESH_QUERY_OK');
      expect(child.status).toBe(0);
    },
  );
});
