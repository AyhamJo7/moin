import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  legacyTodayResponseSchema,
  parseTodayBody,
  todayResponseSchema,
  type TodayResponse,
} from './today.ts';
import * as preM2a from '../test-support/pre-m2a-today.ts';

/** `git show 21241ea:packages/contracts/src/today.ts | git hash-object --stdin` (the parent of #233). */
const PRE_M2A_BLOB = '8e35ad5bb3dc50585093476e12b60e66ecd11ecb';

const TASK = {
  id: '6f0f8a2e-6a39-4f7b-9d0e-2d4c4b7f3a11',
  title: 'Rückruf: Tischreservierung',
  type: 'callback',
  status: 'open',
  priority: 'normal',
  createdAt: '2026-10-17T10:00:00.000Z',
  callerNumber: '+4915198765432',
} as const;

const current = (): TodayResponse => ({ truncated: false, tasks: [{ ...TASK, version: 3 }] });
const legacy = (): unknown => ({ truncated: false, tasks: [{ ...TASK }] });

describe('the frozen pre-M2A contract (what a web built before #233 enforces)', () => {
  it('is the verbatim file of commit 21241ea', () => {
    const bytes = readFileSync(new URL('../test-support/pre-m2a-today.ts', import.meta.url));
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    expect(blob).toBe(PRE_M2A_BLOB);
  });

  it('rejects the current response: the defect this rollout design avoids', () => {
    expect(preM2a.todayResponseSchema.safeParse(current()).success).toBe(false);
  });

  it('accepts the legacy shape', () => {
    expect(preM2a.todayResponseSchema.safeParse(legacy()).success).toBe(true);
  });

  it('is the same shape as the legacy schema served today', () => {
    const body = legacy();
    expect(legacyTodayResponseSchema.safeParse(body).success).toBe(true);
    expect(Object.keys(preM2a.todayTaskSchema.shape).sort()).toEqual(
      Object.keys(legacyTodayResponseSchema.shape.tasks.element.shape).sort(),
    );
  });
});

describe('parseTodayBody', () => {
  it('reads the current shape with its versions', () => {
    expect(parseTodayBody(current())?.tasks[0]?.version).toBe(3);
  });

  it('reads the legacy shape with the version left unknown, never invented', () => {
    const read = parseTodayBody(legacy());
    expect(read?.tasks).toHaveLength(1);
    expect(read?.tasks[0]?.version).toBeNull();
    expect(read?.tasks[0]?.id).toBe(TASK.id);
  });

  it('keeps an empty list and the truncation flag in both shapes', () => {
    expect(parseTodayBody({ truncated: true, tasks: [] })).toEqual({ truncated: true, tasks: [] });
  });

  it.each([
    [
      'a mix of versioned and unversioned tasks',
      { truncated: false, tasks: [{ ...TASK, version: 1 }, { ...TASK }] },
    ],
    ['version zero', { truncated: false, tasks: [{ ...TASK, version: 0 }] }],
    ['a fractional version', { truncated: false, tasks: [{ ...TASK, version: 1.5 }] }],
    ['a string version', { truncated: false, tasks: [{ ...TASK, version: '1' }] }],
    ['a null version', { truncated: false, tasks: [{ ...TASK, version: null }] }],
    [
      'an unknown extra field',
      { truncated: false, tasks: [{ ...TASK, version: 1, tenantId: 'x' }] },
    ],
    [
      'an unknown extra field in the legacy shape',
      { truncated: false, tasks: [{ ...TASK, tenantId: 'x' }] },
    ],
    ['a missing truncation flag', { tasks: [] }],
    ['not an object', 'tasks'],
  ])('is a contract error for %s', (_name, body) => {
    expect(parseTodayBody(body)).toBeNull();
  });

  it('agrees with the strict schema on everything the current shape accepts', () => {
    const body = current();
    expect(todayResponseSchema.parse(body).tasks[0]?.version).toBe(3);
    expect(parseTodayBody(body)?.tasks[0]).toEqual(body.tasks[0]);
  });
});
