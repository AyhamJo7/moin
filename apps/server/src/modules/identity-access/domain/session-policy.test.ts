/**
 * The step-up window constant mirrors the SQL verdict interval (P06.06.04).
 *
 * Authority lives in `app.resolve_request_context` (`step_up_at > v_now - interval
 * '15 minutes'` on the database clock); `STEP_UP_WINDOW_MS` bounds cache service only.
 * If either changes without the other, cached verdicts outlive DB truth (or refuse early)
 * for up to the TTL — so the two are pinned together here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { STEP_UP_WINDOW_MS } from './session-policy.ts';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '0015_step_up_mfa.sql',
);

describe('the step-up window', () => {
  evidenceTest('matches the SQL verdict interval exactly', () => {
    expect(STEP_UP_WINDOW_MS).toBe(15 * 60_000);
    const sql = readFileSync(join(MIGRATION), 'utf8');
    expect(sql).toContain("s.step_up_at > v_now - interval '15 minutes'");
  });
});
