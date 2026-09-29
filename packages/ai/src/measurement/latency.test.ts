import { describe, expect, it } from 'vitest';
import {
  isSufficientlyPowered,
  MARKDOWN_HEADER,
  nearestRankPercentile,
  REQUIRED_MODEL_SAMPLES,
  summarise,
  summariseAll,
  toMarkdownRow,
  type LatencySample,
} from './latency.ts';

function samples(
  arm: string,
  values: readonly number[],
  failures: readonly number[] = [],
): LatencySample[] {
  return values.map((ms) => ({ ms, arm, ok: !failures.includes(ms) }));
}

describe('nearestRankPercentile', () => {
  // Hand-checked: rank = ceil(p/100 * n), one-indexed. With n = 10, p95 → rank 10 → 100.
  const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it.each([
    [50, 50],
    [90, 90],
    [95, 100],
    [100, 100],
    [10, 10],
  ])('p%i of ten evenly spaced samples is %i', (p, expected) => {
    expect(nearestRankPercentile(ten, p)).toBe(expected);
  });

  it('is the single value when there is one sample', () => {
    expect(nearestRankPercentile([42], 95)).toBe(42);
  });

  // The failure this prevents: a report that says "p95: 0 ms" for an arm nobody ran.
  it('refuses to summarise nothing', () => {
    expect(() => nearestRankPercentile([], 95)).toThrow(/no samples/u);
  });

  it.each([0, -1, 101])('rejects an out-of-range percentile: %i', (p) => {
    expect(() => nearestRankPercentile(ten, p)).toThrow(/in \(0, 100\]/u);
  });
});

describe('summarise', () => {
  it('reports n, failures and the percentiles together', () => {
    const summary = summarise('deepgram', samples('deepgram', [100, 200, 300, 400], [400]));
    expect(summary).toStrictEqual({
      arm: 'deepgram',
      n: 4,
      failures: 1,
      p50Ms: 200,
      p95Ms: 400,
      minMs: 100,
      maxMs: 400,
    });
  });

  // A provider that times out on one call in twenty looks excellent if only successes are
  // measured. The timed-out call is a sample, at its deadline.
  it('counts failures in the distribution rather than dropping them', () => {
    const withFailure = summarise('a', samples('a', [100, 100, 100, 5000], [5000]));
    const withoutFailure = summarise('a', samples('a', [100, 100, 100]));
    expect(withFailure.p95Ms).toBe(5000);
    expect(withoutFailure.p95Ms).toBe(100);
    expect(withFailure.failures).toBe(1);
  });

  it('separates arms', () => {
    const mixed = [...samples('a', [100, 200]), ...samples('b', [1000, 2000])];
    expect(summarise('a', mixed).p50Ms).toBe(100);
    expect(summarise('b', mixed).p50Ms).toBe(1000);
  });

  it('refuses an arm with no samples', () => {
    expect(() => summarise('missing', samples('a', [1]))).toThrow(/no samples for arm/u);
  });

  it('summarises every arm in the order they first appear', () => {
    const mixed = [...samples('b', [1]), ...samples('a', [2]), ...samples('b', [3])];
    expect(summariseAll(mixed).map((s) => s.arm)).toStrictEqual(['b', 'a']);
  });
});

describe('presenting a summary', () => {
  it('marks an under-powered arm so the reader cannot miss it', () => {
    const thin = summarise('a', samples('a', [1, 2, 3]));
    expect(isSufficientlyPowered(thin)).toBe(false);
    expect(toMarkdownRow(thin)).toContain('under-powered');
  });

  it('accepts an arm at the required sample count', () => {
    const wide = summarise(
      'a',
      samples(
        'a',
        Array.from({ length: REQUIRED_MODEL_SAMPLES }, (_, i) => i + 1),
      ),
    );
    expect(isSufficientlyPowered(wide)).toBe(true);
    expect(toMarkdownRow(wide)).not.toContain('under-powered');
  });

  it('produces a row with the same column count as the header', () => {
    const row = toMarkdownRow(summarise('a', samples('a', [1])));
    const columns = (line: string): number => line.split('|').length;
    expect(columns(row)).toBe(columns(MARKDOWN_HEADER.split('\n')[0] ?? ''));
  });
});
