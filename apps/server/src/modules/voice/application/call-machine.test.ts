/**
 * Call machine tables (P11.05.04): full lifecycle, timeout paths, the
 * transition property (closed is terminal, outcomes always present), and
 * checkpoint recovery after process loss.
 */
import { describe, expect, it } from 'vitest';
import { initialCall, recoverFromCheckpoint, transition } from './call-machine.ts';
import type { CallEvent, CallMachine, CallState } from './call-machine.ts';

const EVENTS: readonly CallEvent[] = [
  { kind: 'answered' },
  { kind: 'slot-confirmed' },
  { kind: 'silence-timeout' },
  { kind: 'duration-cap' },
  { kind: 'wrap-complete' },
  { kind: 'failed' },
  { kind: 'hung-up' },
];

describe('call machine', () => {
  it('runs the full lifecycle: ringing → active → wrapping → closed', () => {
    let m = initialCall();
    expect(m.state).toBe('ringing');
    m = transition(m, { kind: 'answered' });
    expect(m.state).toBe('active');
    m = transition(m, { kind: 'slot-confirmed' });
    expect(m.state).toBe('active');
    m = transition(m, { kind: 'hung-up' });
    expect(m).toMatchObject({ state: 'wrapping', outcome: { outcome: 'callback-task' } });
    m = transition(m, { kind: 'wrap-complete' });
    expect(m).toMatchObject({ state: 'closed', outcome: { outcome: 'callback-task' } });
  });

  it('reprompts once on silence, wraps on the second timeout', () => {
    let m = transition(initialCall(), { kind: 'answered' });
    m = transition(m, { kind: 'silence-timeout' });
    expect(m).toMatchObject({ state: 'active', reprompted: true });
    m = transition(m, { kind: 'silence-timeout' });
    expect(m).toMatchObject({ state: 'wrapping', outcome: { outcome: 'callback-task' } });
  });

  it('property: closed is terminal and always carries an outcome', () => {
    const states: CallState[] = ['ringing', 'active', 'wrapping', 'closed'];
    for (const state of states) {
      for (const event of EVENTS) {
        const base: CallMachine =
          state === 'closed'
            ? { state, reprompted: true, outcome: { outcome: 'completed' } }
            : { state, reprompted: false, outcome: null };
        const next = transition(base, event);
        expect(['ringing', 'active', 'wrapping', 'closed']).toContain(next.state);
        if (next.state === 'closed') expect(next.outcome).not.toBeNull();
      }
    }
    // Closed never reopens.
    const closed = transition(
      { state: 'closed', reprompted: true, outcome: { outcome: 'failed' } },
      { kind: 'answered' },
    );
    expect(closed.state).toBe('closed');
  });

  it('recovers a callback task from the last checkpoint after process loss', () => {
    expect(recoverFromCheckpoint(null)).toStrictEqual({ outcome: 'callback-task' });
    expect(recoverFromCheckpoint({ outcome: 'completed' })).toStrictEqual({
      outcome: 'completed',
    });
  });
});
