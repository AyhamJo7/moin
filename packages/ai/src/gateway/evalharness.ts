/**
 * Evaluation harness (P10.13, QG-07, A-19).
 *
 * Datasets live in `evals/<suite>/` with a manifest (name, hash, N, suite);
 * every fixture is synthetic (A-19). The runner takes recorded answers —
 * PR runs are deterministic and free; live-model runs (nightly + AI changes)
 * reuse the same scoring with a different answer source.
 *
 * Scoring: per-intent accuracy plus Wilson 95 % lower bounds; minimum-N
 * enforcement (a gate passes when point ≥ threshold AND N ≥ minimum AND
 * critical failures = 0). Reports bind to the version set (P10.06 manifest)
 * and carry the previous report's point for trend comparison (P10.13.03).
 * `checkQualityGate` is the QG-07 wiring (P10.13.04).
 */

export type EvalSuite = 'dev' | 'heldout' | 'adversarial' | 'emergency' | 'knowledge';

export interface EvalCase {
  readonly input: string;
  readonly intent: string;
  /** Empty when the case must abstain. */
  readonly expectedSlot?: string;
  readonly critical: boolean;
}

export interface EvalDataset {
  readonly name: string;
  readonly suite: EvalSuite;
  /** SHA-256 of the canonical JSON, first 12 hex (manifest convention). */
  readonly hash: string;
  readonly cases: readonly EvalCase[];
}

export interface ScoredCase {
  readonly correct: boolean;
  readonly criticalFailure: boolean;
}

export interface IntentMetric {
  readonly intent: string;
  readonly n: number;
  readonly point: number;
  readonly wilsonLow: number;
}

export interface EvalReport {
  readonly dataset: string;
  readonly datasetHash: string;
  readonly versionSet: string;
  readonly n: number;
  readonly point: number;
  readonly wilsonLow: number;
  readonly criticalFailures: number;
  readonly byIntent: readonly IntentMetric[];
  readonly previousPoint: number | null;
}

/** Wilson 95 % lower bound (z = 1.96). */
export function wilsonLow(hits: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - spread) / denom);
}

export function scoreAnswers(
  dataset: EvalDataset,
  answers: readonly { intent: string; slot?: string }[],
  versionSet: string,
  previousPoint: number | null = null,
): EvalReport {
  let hits = 0;
  let criticalFailures = 0;
  const byIntent = new Map<string, { hits: number; n: number }>();
  dataset.cases.forEach((c, i) => {
    const a = answers[i];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- answers[i] is possibly undefined by index type; the chain is the missing-answer guard.
    const correct = a?.intent === c.intent && (a?.slot ?? '') === (c.expectedSlot ?? '');
    if (correct) hits += 1;
    else if (c.critical) criticalFailures += 1;
    const entry = byIntent.get(c.intent) ?? { hits: 0, n: 0 };
    byIntent.set(c.intent, { hits: entry.hits + (correct ? 1 : 0), n: entry.n + 1 });
  });
  const n = dataset.cases.length;
  return {
    dataset: dataset.name,
    datasetHash: dataset.hash,
    versionSet,
    n,
    point: n === 0 ? 0 : hits / n,
    wilsonLow: wilsonLow(hits, n),
    criticalFailures,
    byIntent: [...byIntent.entries()].map(([intent, e]) => ({
      intent,
      n: e.n,
      point: e.n === 0 ? 0 : e.hits / e.n,
      wilsonLow: wilsonLow(e.hits, e.n),
    })),
    previousPoint,
  };
}

export interface QualityGate {
  readonly threshold: number;
  readonly minimumN: number;
}

/** QG-07: point ≥ threshold AND N ≥ minimum AND 0 critical failures. */
export function checkQualityGate(report: EvalReport, gate: QualityGate): boolean {
  return (
    report.point >= gate.threshold && report.n >= gate.minimumN && report.criticalFailures === 0
  );
}
