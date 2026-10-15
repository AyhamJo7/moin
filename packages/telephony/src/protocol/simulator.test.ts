/**
 * Protocol simulator (P11.16.01/.02): scripted frames exercise the full
 * decode path — every message type, unknown, invalid.
 */
import { describe, expect, it } from 'vitest';
import { FULL_PATH_SCENARIO, runScenario } from './simulator.ts';

describe('protocol simulator', () => {
  it('exercises the full path through the real codec', () => {
    const exchange = runScenario(FULL_PATH_SCENARIO);
    expect(exchange.sent).toHaveLength(6);
    expect(exchange.kinds).toStrictEqual([
      'message',
      'message',
      'message',
      'message',
      'unknown',
      'invalid',
    ]);
  });

  it('fails loudly when the path breaks', () => {
    expect(() =>
      runScenario({
        name: 'broken',
        steps: [{ send: { type: 'setup' } }, { expectDecode: 'message' }],
      }),
    ).toThrow('expected decode');
  });
});
