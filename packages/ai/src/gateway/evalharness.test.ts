/**
 * Eval harness (P10.13.05, QG-07): the runner scores a synthetic known-answer
 * dataset correctly — points, Wilson bounds, per-intent splits, minimum-N
 * and critical-failure gating, trend binding. Synthetic only (A-19).
 */
import { describe, expect, it } from 'vitest';
import { checkQualityGate, scoreAnswers, wilsonLow } from './evalharness.ts';
import type { EvalDataset } from './evalharness.ts';

const DATASET: EvalDataset = {
  name: 'dev-v1',
  suite: 'dev',
  hash: 'abc123def456',
  cases: [
    { input: 'Tisch für vier', intent: 'booking', expectedSlot: '4', critical: false },
    { input: 'Tisch für zwei', intent: 'booking', expectedSlot: '2', critical: false },
    { input: 'Notarzt rufen', intent: 'emergency', critical: true },
    { input: 'Öffnungszeiten', intent: 'faq', critical: false },
  ],
};

describe('eval harness', () => {
  it('scores known answers: point, Wilson, per-intent, trend binding', () => {
    const report = scoreAnswers(
      DATASET,
      [
        { intent: 'booking', slot: '4' },
        { intent: 'booking', slot: '3' },
        { intent: 'emergency' },
        { intent: 'faq' },
      ],
      'prompt.aaa.policy.bbb.template.ccc.schema.ddd',
      0.5,
    );
    expect(report.point).toBe(0.75);
    expect(report.wilsonLow).toBeGreaterThan(0);
    expect(report.wilsonLow).toBeLessThanOrEqual(report.point);
    expect(report.criticalFailures).toBe(0);
    expect(report.byIntent.find((m) => m.intent === 'booking')?.point).toBe(0.5);
    expect(report.previousPoint).toBe(0.5);
    expect(report.versionSet).toContain('prompt.aaa');
  });

  it('counts critical failures when a critical case misses', () => {
    const report = scoreAnswers(
      DATASET,
      [
        { intent: 'booking', slot: '4' },
        { intent: 'booking', slot: '2' },
        { intent: 'faq' },
        { intent: 'faq' },
      ],
      'v',
    );
    expect(report.criticalFailures).toBe(1);
    expect(checkQualityGate(report, { threshold: 0.5, minimumN: 1 })).toBe(false);
  });

  it('enforces minimum-N and threshold (QG-07)', () => {
    const small: EvalDataset = {
      name: 'tiny',
      suite: 'dev',
      hash: 'x',
      cases: [{ input: 'a', intent: 'faq', critical: false }],
    };
    const perfect = scoreAnswers(small, [{ intent: 'faq' }], 'v');
    expect(checkQualityGate(perfect, { threshold: 0.9, minimumN: 60 })).toBe(false);
    expect(checkQualityGate(perfect, { threshold: 0.9, minimumN: 1 })).toBe(true);
    expect(checkQualityGate(perfect, { threshold: 1.1, minimumN: 1 })).toBe(false);
  });

  it('Wilson bounds behave: 0/0 is 0, perfect small-N stays below 1', () => {
    expect(wilsonLow(0, 0)).toBe(0);
    expect(wilsonLow(1, 1)).toBeLessThan(1);
    expect(wilsonLow(60, 60)).toBeGreaterThan(wilsonLow(1, 1));
  });
});
