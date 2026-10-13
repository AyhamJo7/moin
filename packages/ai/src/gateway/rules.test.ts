/**
 * Owner rules tables (P10.10.05): evaluation order, most-specific-wins,
 * tie-by-order, template defaults, invalid rejection, run records.
 */
import { describe, expect, it } from 'vitest';
import { evaluateRules, RESTAURANT_DEFAULT_RULES } from './rules.ts';
import type { OwnerRule, RuleFacts } from './rules.ts';

function facts(over: Partial<RuleFacts> = {}): RuleFacts {
  return {
    intent: 'callback',
    urgency: 'routine',
    hour: 14,
    channel: 'voice',
    callerKnown: false,
    afterHours: false,
    ...over,
  };
}

describe('owner rules', () => {
  it('most specific match wins; ties go by explicit order', () => {
    const rules: OwnerRule[] = [
      { name: 'generic', trigger: { channel: 'voice' }, actions: { taskType: 'callback' } },
      {
        name: 'specific',
        trigger: { channel: 'voice', intent: 'callback' },
        actions: { priority: 'high' },
      },
    ];
    expect(evaluateRules(rules, facts())).toMatchObject({
      actions: { priority: 'high' },
      run: { ruleName: 'specific' },
    });
    const tied: OwnerRule[] = [
      { name: 'first', trigger: { channel: 'voice' }, actions: { priority: 'low' } },
      { name: 'second', trigger: { channel: 'voice' }, actions: { priority: 'high' } },
    ];
    expect(evaluateRules(tied, facts())).toMatchObject({ run: { ruleName: 'first' } });
  });

  it('template defaults: emergency notifies, voice takes a callback task', () => {
    expect(evaluateRules(RESTAURANT_DEFAULT_RULES, facts({ urgency: 'emergency' }))).toMatchObject({
      actions: { notify: 'owner', routeToHuman: true },
      run: { ruleName: 'after-hours-emergency-notify' },
    });
    const routine = evaluateRules(RESTAURANT_DEFAULT_RULES, facts());
    expect(routine).toMatchObject({
      actions: { taskType: 'callback' },
      run: { ruleName: 'after-hours-callback-task' },
    });
    // toMatchObject above pins the error branch absent; narrow to the run.
    const run = (routine as unknown as { run: { at: string } }).run;
    expect(run.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('matches time windows and caller-known triggers', () => {
    const rules: OwnerRule[] = [
      {
        name: 'night',
        trigger: { timeWindow: [22, 6] as unknown as readonly [number, number] },
        actions: { taskType: 'callback' },
      },
      { name: 'known', trigger: { callerKnown: true }, actions: { priority: 'high' } },
    ];
    expect(evaluateRules(rules, facts({ hour: 23 }))).toMatchObject({
      run: { ruleName: 'night' },
    });
    expect(evaluateRules(rules, facts({ hour: 12 }))).toMatchObject({
      error: expect.stringContaining('no rule'),
    });
    expect(evaluateRules(rules, facts({ callerKnown: true }))).toMatchObject({
      run: { ruleName: 'known' },
    });
  });

  it('rejects invalid rules and reports no-match', () => {
    expect(evaluateRules([{ name: '', trigger: {}, actions: {} }], facts())).toMatchObject({
      error: expect.stringContaining('name'),
    });
    expect(evaluateRules([{ name: 'x', trigger: {}, actions: {} }], facts())).toMatchObject({
      error: expect.stringContaining('trigger'),
    });
    expect(
      evaluateRules([{ name: 'x', trigger: { channel: 'voice' }, actions: {} }], facts()),
    ).toMatchObject({ error: expect.stringContaining('action') });
    expect(evaluateRules([], facts())).toMatchObject({ error: 'no rule matched' });
  });
});
