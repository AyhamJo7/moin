/**
 * Escalation chains (P14.05.04): fires on no-ack, stops on ack. Pure clock
 * control; the integration leg covers the rows.
 */
import { describe, expect, it } from 'vitest';
import { chainStep, type EscalationLevel } from './escalation.ts';

const LEVELS: readonly EscalationLevel[] = [
  { level: 0, contactUserId: 'a', dueAtMs: 1_000 },
  { level: 1, contactUserId: 'b', dueAtMs: 2_000 },
];

describe('escalation chain', () => {
  it('fires each level past its deadline under clock control', () => {
    expect(chainStep(LEVELS, null, 500)).toEqual({ stopped: false, fireLevel: null });
    expect(chainStep(LEVELS, null, 1_500).fireLevel?.contactUserId).toBe('a');
    expect(chainStep(LEVELS, null, 2_500).fireLevel?.contactUserId).toBe('a');
  });

  it('stops the chain on acknowledgement', () => {
    expect(chainStep(LEVELS, 'acknowledged', 2_500)).toEqual({ stopped: true, fireLevel: null });
    expect(chainStep(LEVELS, 'done', 2_500)).toEqual({ stopped: true, fireLevel: null });
    expect(chainStep(LEVELS, 'exhausted', 2_500)).toEqual({ stopped: true, fireLevel: null });
  });
});
