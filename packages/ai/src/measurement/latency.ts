/**
 * Latency distributions (P04.03.03, P04.03.05, P04.05.05).
 *
 * ## Why this is not three lines of arithmetic
 *
 * P04's exit gate is a number: p95 ≤ 1.8 s, or a credible path to it. A number like that decides
 * whether the product is built at all, so how it is computed has to be written down and testable
 * rather than improvised in a notebook the week the decision is made.
 *
 * Three choices here are the ones that usually go wrong:
 *
 * **Percentiles are nearest-rank, and N travels with them.** There is no single definition of
 * "p95"; the interpolating ones differ from the rank-based ones by enough to change a go/no-go at
 * small N. Nearest-rank is stated, implemented, and tested against a hand-checked example. And a
 * percentile without its N is not a measurement — p95 of eleven samples is the second-slowest
 * call. So the summary cannot be constructed without N, and the report prints it.
 *
 * **Failures are counted, not dropped.** A provider that times out on one call in twenty looks
 * excellent if only its successes are measured. Timeouts are recorded with their deadline as the
 * observed value and counted separately, so a fast-but-unreliable arm cannot beat a slower
 * reliable one by disappearing.
 *
 * **No means.** A mean latency is dominated by the tail it is meant to describe, and no caller
 * experiences it. p50 and p95 are reported; the mean is not offered, so it cannot be quoted.
 */

export interface LatencySample {
  readonly ms: number;
  readonly ok: boolean;
  /** Free-form arm label: the provider, the model, the voice — whatever is being compared. */
  readonly arm: string;
}

export interface LatencySummary {
  readonly arm: string;
  /** Every sample, successful or not. A percentile without this is not a measurement. */
  readonly n: number;
  readonly failures: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * Nearest-rank percentile: the smallest value at or below which at least `p` percent of the
 * samples fall. `rank = ceil(p / 100 * n)`, one-indexed, clamped to `n`.
 */
export function nearestRankPercentile(sortedMs: readonly number[], p: number): number {
  if (sortedMs.length === 0) {
    throw new Error('a percentile of no samples is not a number');
  }
  if (p <= 0 || p > 100) {
    throw new Error('percentile must be in (0, 100]');
  }
  const rank = Math.min(sortedMs.length, Math.ceil((p / 100) * sortedMs.length));
  const value = sortedMs[rank - 1];
  /* c8 ignore next -- rank is clamped into range above. */
  return value ?? sortedMs[sortedMs.length - 1] ?? 0;
}

/** Summarises one arm. Throws on an empty arm rather than reporting zeros. */
export function summarise(arm: string, samples: readonly LatencySample[]): LatencySummary {
  const own = samples.filter((s) => s.arm === arm);
  if (own.length === 0) {
    throw new Error(`no samples for arm ${JSON.stringify(arm)}`);
  }
  const sorted = own.map((s) => s.ms).sort((a, b) => a - b);
  return {
    arm,
    n: own.length,
    failures: own.filter((s) => !s.ok).length,
    p50Ms: nearestRankPercentile(sorted, 50),
    p95Ms: nearestRankPercentile(sorted, 95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

/** Summarises every arm present, in the order the arms first appear. */
export function summariseAll(samples: readonly LatencySample[]): readonly LatencySummary[] {
  const arms: string[] = [];
  for (const sample of samples) {
    if (!arms.includes(sample.arm)) {
      arms.push(sample.arm);
    }
  }
  return arms.map((arm) => summarise(arm, samples));
}

/**
 * The minimum sample count PLAN requires of a model-latency distribution (P04.03.05).
 *
 * Exported so that the report generator can refuse to present an under-powered arm as a result,
 * rather than leaving that judgement to whoever reads the table.
 */
export const REQUIRED_MODEL_SAMPLES = 200;

/** Whether a summary is allowed to be presented as a measurement rather than as a spot check. */
export function isSufficientlyPowered(
  summary: LatencySummary,
  minimum = REQUIRED_MODEL_SAMPLES,
): boolean {
  return summary.n >= minimum;
}

/** Renders a Markdown table row, so the report and the harness cannot disagree on the format. */
export function toMarkdownRow(summary: LatencySummary): string {
  const note = isSufficientlyPowered(summary) ? '' : ' *(under-powered)*';
  return `| ${summary.arm} | ${summary.n}${note} | ${summary.failures} | ${summary.p50Ms} | ${summary.p95Ms} | ${summary.minMs} | ${summary.maxMs} |`;
}

export const MARKDOWN_HEADER = [
  '| arm | N | failures | p50 ms | p95 ms | min ms | max ms |',
  '| --- | --- | --- | --- | --- | --- | --- |',
].join('\n');
