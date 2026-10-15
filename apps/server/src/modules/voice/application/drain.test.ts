/**
 * Deployment draining (P11.15.01/.02): drain refuses new, in-flight
 * completes, health reports draining, forced shutdown tasks checkpoints.
 */
import { describe, expect, it } from 'vitest';
import {
  admitsNew,
  beginDrain,
  callFinished,
  DRAIN_GRACE_MS,
  forcedShutdownTasks,
} from './drain.ts';

describe('deployment draining', () => {
  it('drain refuses new calls; empty drains immediately', () => {
    expect(admitsNew('serving')).toBe(true);
    expect(admitsNew('draining')).toBe(false);
    expect(admitsNew('drained')).toBe(false);
    expect(beginDrain(0)).toStrictEqual({ state: 'drained', inFlight: 0 });
    expect(beginDrain(5)).toStrictEqual({ state: 'draining', inFlight: 5 });
    expect(DRAIN_GRACE_MS).toBe(30_000);
  });

  it('in-flight calls complete, then the instance is drained', () => {
    let tracker = beginDrain(2);
    tracker = callFinished(tracker);
    expect(tracker).toStrictEqual({ state: 'draining', inFlight: 1 });
    tracker = callFinished(tracker);
    expect(tracker).toStrictEqual({ state: 'drained', inFlight: 0 });
  });

  it('forced shutdown converts active calls to callback tasks (FS-12)', () => {
    expect(forcedShutdownTasks(5)).toBe(5);
    expect(forcedShutdownTasks(0)).toBe(0);
  });
});
