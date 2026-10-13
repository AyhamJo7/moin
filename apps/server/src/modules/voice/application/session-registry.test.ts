/** Session registry (P11.04.02/.04/.05): cap, saturation, idle, release. */
import { describe, expect, it } from 'vitest';
import { createSessionRegistry, IDLE_TIMEOUT_MS, MAX_SESSIONS } from './session-registry.ts';

function entry(id: string, atMs = 0) {
  return { sessionId: id, callSid: `CA${id}`, lastFrameAtMs: atMs };
}

describe('session registry', () => {
  it('admits up to 20 sessions, refuses the 21st (saturation)', () => {
    expect(MAX_SESSIONS).toBe(20);
    const registry = createSessionRegistry();
    for (let i = 0; i < 20; i += 1) {
      expect(registry.admit(entry(`s${i}`))).toBe(true);
    }
    expect(registry.saturated()).toBe(true);
    expect(registry.admit(entry('s20'))).toBe(false);
    expect(registry.size).toBe(20);
  });

  it('release frees a slot; touch resets idleness', () => {
    const registry = createSessionRegistry();
    registry.admit(entry('a', 0));
    registry.admit(entry('b', 0));
    expect(registry.idle(IDLE_TIMEOUT_MS)).toStrictEqual(['a', 'b']);
    registry.touch('a', IDLE_TIMEOUT_MS);
    expect(registry.idle(IDLE_TIMEOUT_MS + 1)).toStrictEqual(['b']);
    registry.release('b');
    expect(registry.size).toBe(1);
    expect(registry.saturated()).toBe(false);
    expect(registry.admit(entry('c', 0))).toBe(true);
  });
});
