/**
 * Reconciliation diff (P11.09.03, INV-06): missing-local backfills, missing
 * remote flags, duration mismatch corrects, repeats are stable.
 */
import { describe, expect, it } from 'vitest';
import { reconcileCalls } from './reconcile.ts';

describe('call-log reconciliation', () => {
  it('backfills missing-local, flags missing-remote, corrects duration', () => {
    const actions = reconcileCalls(
      [
        { callSid: 'CA1', durationSecs: 60 },
        { callSid: 'CA2', durationSecs: 30 },
        { callSid: 'CA3', durationSecs: 10 },
      ],
      [
        { callSid: 'CA2', durationSecs: 30, hasOutcome: true },
        { callSid: 'CA3', durationSecs: 99, hasOutcome: true },
        { callSid: 'CA4', durationSecs: 5, hasOutcome: true },
      ],
    );
    expect(actions).toContainEqual({ kind: 'backfill-task', callSid: 'CA1' });
    expect(actions).toContainEqual({
      kind: 'correct-duration',
      callSid: 'CA3',
      durationSecs: 10,
    });
    expect(actions).toContainEqual({ kind: 'flag-missing-remote', callSid: 'CA4' });
    expect(actions).toHaveLength(3);
  });

  it('a local row without an outcome backfills (webhook loss)', () => {
    expect(
      reconcileCalls(
        [{ callSid: 'CA1', durationSecs: 60 }],
        [{ callSid: 'CA1', durationSecs: 60, hasOutcome: false }],
      ),
    ).toStrictEqual([{ kind: 'backfill-task', callSid: 'CA1' }]);
  });

  it('repeated runs are stable — no duplicate tasks', () => {
    const remote = [{ callSid: 'CA1', durationSecs: 60 }];
    const local = [{ callSid: 'CA1', durationSecs: 60, hasOutcome: true }];
    expect(reconcileCalls(remote, local)).toStrictEqual([]);
    expect(reconcileCalls(remote, local)).toStrictEqual([]);
  });
});
