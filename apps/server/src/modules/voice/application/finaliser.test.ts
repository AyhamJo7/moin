/**
 * Finaliser tables (P11.06.04, FS-01): every permutation of callback order
 * (incl. duplicates) yields one outcome; late callbacks never move the call
 * backwards; duration recorded.
 */
import { describe, expect, it } from 'vitest';
import { createFinaliser } from './finaliser.ts';
import type { CallStatus, StatusCallback } from './finaliser.ts';

function cb(status: CallStatus, sequence: number, duration?: number): StatusCallback {
  return {
    callSid: 'CA1',
    status,
    sequence,
    ...(duration === undefined ? {} : { callDurationSecs: duration }),
  };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    return permutations(rest).map((p) => [item, ...p]);
  });
}

describe('call finaliser', () => {
  it('every permutation of callback order yields exactly one outcome (FS-01)', () => {
    const orderings = permutations([
      cb('ringing', 1),
      cb('in_progress', 2),
      cb('completed', 3, 120),
    ]);
    expect(orderings).toHaveLength(6);
    for (const ordering of orderings) {
      const finaliser = createFinaliser();
      const outcomes = ordering.map((c) => finaliser.ingest(c)).filter((o) => o !== null);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({
        callSid: 'CA1',
        status: 'completed',
        callDurationSecs: 120,
        finalised: true,
      });
    }
  });

  it('duplicates (3×) and late out-of-order callbacks change nothing', () => {
    const finaliser = createFinaliser();
    const first = finaliser.ingest(cb('completed', 3, 60));
    expect(first?.finalised).toBe(true);
    // Same delivery three more times: deduped.
    expect(finaliser.ingest(cb('completed', 3, 60))).toBeNull();
    expect(finaliser.ingest(cb('completed', 3, 60))).toBeNull();
    expect(finaliser.ingest(cb('completed', 3, 60))).toBeNull();
    // Late ringing after completed: monotonic ladder refuses.
    expect(finaliser.ingest(cb('ringing', 4))).toBeNull();
    // Failed after completed: terminal already finalised.
    expect(finaliser.ingest(cb('failed', 5))).toBeNull();
  });

  it('terminal siblings each finalise once (failed/busy/no_answer)', () => {
    for (const status of ['failed', 'busy', 'no_answer'] as const) {
      const finaliser = createFinaliser();
      expect(finaliser.ingest(cb(status, 2))).toMatchObject({ status, finalised: true });
      expect(finaliser.ingest(cb(status, 2))).toBeNull();
    }
  });
});
