/**
 * The mutation sweep (QG-09 negative controls, P06.10.07).
 *
 * ## Why this exists as a committed tool rather than a one-off script
 *
 * A test that has never been made to fail is a hope, not a control. Every guard in the audit
 * subsystem therefore has at least one *defective variant*: a named, minimal edit that would
 * reintroduce the defect the guard exists to prevent. The manifest is data
 * (`docs/verification/audit-mutation-manifest.json`) so the set is *inspectable*: each entry names
 * the invariant it targets, what failure is expected, and which test kills it. A total count alone
 * tells a reviewer nothing about coverage.
 *
 * ## Two rules that make the count mean something
 *
 * 1. **A baseline first.** The named test is run against the pristine tree and must actually run
 *    and pass. Without that, a variant "killed" by a test that was already failing is no evidence
 *    at all, and the report would launder a broken suite into a perfect score.
 * 2. **The outcome comes from the structured report, not the exit code.** The previous version
 *    counted any non-zero exit as a kill — so an unreachable database reported every variant killed,
 *    and a manifest entry naming a nonexistent test reported it survived. `mutation-outcome.ts`
 *    makes that decision over Vitest's JSON report and distinguishes an assertion rejecting the
 *    mutation from a timeout, a transform error, a setup failure or an unrelated failure.
 *
 * A variant that SURVIVES is not a code defect — it means the test is weaker than it looks, or the
 * guard it removes is redundant with another. Both have happened here, and both are worth knowing.
 *
 *   node scripts/mutation-sweep.ts --validate     # anchors resolve; changes nothing, runs nothing
 *   node scripts/mutation-sweep.ts                # baseline + mutant for every variant
 *   node scripts/mutation-sweep.ts --only B4-1-…  # one variant
 *   node scripts/mutation-sweep.ts --report docs/verification/audit-mutation-report.md
 *   node scripts/mutation-sweep.ts --json out.json
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  baselineIsUsable,
  classifyRun,
  type Classification,
  type MutationOutcome,
  type MutationReport,
} from './mutation-outcome.ts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'docs', 'verification', 'audit-mutation-manifest.json');
const TEST_TIMEOUT_MS = 1_200_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

interface Variant {
  readonly id: string;
  readonly invariant: string;
  readonly expected: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  readonly test: string;
  readonly kills: string;
  /**
   * Why this variant's outcome is not `KILLED_ASSERTION`, when that is expected and correct.
   *
   * Some defects are rejected by a guard that runs *before* any test — an assertion inside a
   * migration, for instance — so the suite never starts and no test can claim the kill. That is a
   * stronger control than a test, not a missing one, and saying so here keeps the report honest
   * without inflating the evidence count.
   */
  readonly note?: string;
}

interface Result {
  readonly variant: Variant;
  readonly baseline: MutationOutcome | 'PASSED';
  readonly outcome: MutationOutcome;
  readonly detail: string;
  readonly matched: number;
  readonly unrelatedFailures: number;
  readonly baselineMs: number;
  readonly mutantMs: number;
}

function manifest(): readonly Variant[] {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('mutation manifest is not an array');
  return parsed as readonly Variant[];
}

/** Runs one filtered Vitest invocation and observes it structurally. */
async function observe(
  variant: Variant,
  phase: 'baseline' | 'mutant',
): Promise<{ classification: Classification; durationMs: number }> {
  const directory = mkdtempSync(join(tmpdir(), 'moin-mutation-'));
  const reportPath = join(directory, 'report.json');
  const startedAt = Date.now();
  let output: string;
  let exitCode: number | null = 0;
  let timedOut = false;

  try {
    const { stdout, stderr } = await run(
      process.execPath,
      [
        './node_modules/vitest/vitest.mjs',
        'run',
        '--project',
        'integration',
        variant.test,
        '-t',
        variant.kills,
        // The project's own reporter, because the built-in JSON report renders failures as text
        // and an assertion must be identified by what the error *is*, not by what it says.
        '--reporter=./scripts/mutation-reporter.ts',
      ],
      {
        cwd: REPO,
        timeout: TEST_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, MOIN_MUTATION_REPORT: reportPath },
      },
    );
    output = `${stdout}${stderr}`;
  } catch (error) {
    const failure = error as {
      code?: number | string;
      killed?: boolean;
      signal?: string | null;
      stdout?: string;
      stderr?: string;
    };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    exitCode = typeof failure.code === 'number' ? failure.code : null;
    // `execFile` reports a timeout by killing the child; `code` is then not a number.
    timedOut = failure.killed === true && typeof failure.code !== 'number';
  }

  let report: MutationReport | undefined;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as MutationReport;
  } catch {
    report = undefined;
  }
  rmSync(directory, { recursive: true, force: true });

  return {
    classification: classifyRun({ report, timedOut, exitCode, output, phase }, variant.kills),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Baseline, then mutant.
 *
 * The baseline is cached by test file plus filter: several variants legitimately share one killing
 * test, and re-running it per variant would multiply the sweep's cost for no extra assurance. The
 * cache key is exactly what determines the result, and it lives only for this process, so it cannot
 * outlive the tree it was measured against.
 */
async function sweep(
  variant: Variant,
  baselines: Map<string, { classification: Classification; durationMs: number }>,
): Promise<Result> {
  const path = join(REPO, variant.file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(variant.find)) {
    return {
      variant,
      baseline: 'BASELINE_FAILED',
      outcome: 'INVALID_MUTANT',
      detail: `the anchor is not present in ${variant.file}, so the variant could not be applied`,
      matched: 0,
      unrelatedFailures: 0,
      baselineMs: 0,
      mutantMs: 0,
    };
  }

  const key = `${variant.test}\u0000${variant.kills}`;
  let baseline = baselines.get(key);
  if (baseline === undefined) {
    baseline = await observe(variant, 'baseline');
    baselines.set(key, baseline);
  }

  if (!baselineIsUsable(baseline.classification)) {
    return {
      variant,
      baseline:
        baseline.classification.outcome === 'SURVIVED'
          ? 'BASELINE_FAILED'
          : baseline.classification.outcome,
      outcome: 'BASELINE_FAILED',
      detail: `the killing test does not pass cleanly on the pristine tree: ${baseline.classification.detail}`,
      matched: baseline.classification.matched,
      unrelatedFailures: baseline.classification.unrelatedFailures,
      baselineMs: baseline.durationMs,
      mutantMs: 0,
    };
  }

  try {
    writeFileSync(path, original.replace(variant.find, variant.replace));
    const mutant = await observe(variant, 'mutant');
    return {
      variant,
      baseline: 'PASSED',
      outcome: mutant.classification.outcome,
      detail: mutant.classification.detail,
      matched: mutant.classification.matched,
      unrelatedFailures: mutant.classification.unrelatedFailures,
      baselineMs: baseline.durationMs,
      mutantMs: mutant.durationMs,
    };
  } finally {
    // Restored from memory rather than from git, so a sweep can never depend on a clean tree and
    // can never be mistaken for a revert.
    writeFileSync(path, original);
  }
}

function distribution(results: readonly Result[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
  }
  return counts;
}

function reportMarkdown(results: readonly Result[]): string {
  const counts = distribution(results);
  const killed = counts.get('KILLED_ASSERTION') ?? 0;
  const summary = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `- **${outcome}:** ${String(count)}`)
    .join('\n');

  const rows = results
    .map(
      (result) =>
        [
          `| \`${result.variant.id}\``,
          result.variant.invariant,
          result.variant.expected,
          `\`${result.variant.file}\``,
          `\`${result.variant.test}\` — “${result.variant.kills}”`,
          result.baseline === 'PASSED' ? 'passed' : `**${result.baseline}**`,
          `**${result.outcome}**`,
          `${result.detail.replace(/\|/gu, '\\|')}${result.variant.note === undefined ? '' : ` — *${result.variant.note.replace(/\|/gu, '\\|')}*`}`,
          `${String(Math.round(result.baselineMs / 100) / 10)}s / ${String(Math.round(result.mutantMs / 100) / 10)}s`,
        ].join(' | ') + ' |',
    )
    .join('\n');

  return [
    `# Audit mutation sweep — ${String(killed)}/${String(results.length)} KILLED_ASSERTION`,
    '',
    'Only `KILLED_ASSERTION` is evidence: the named test ran on the pristine tree, passed, then ran',
    'against the mutated source and rejected it on an assertion. Every other outcome is reported as',
    'itself rather than folded into a kill count.',
    '',
    summary,
    '',
    '| Variant | Invariant targeted | Expected failure if it shipped | Source | Killing test | Baseline | Outcome | Detail | Baseline / mutant |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

async function main(): Promise<number> {
  const variants = manifest();
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];
  const reportIndex = process.argv.indexOf('--report');
  const reportPath = reportIndex === -1 ? undefined : process.argv[reportIndex + 1];
  const jsonIndex = process.argv.indexOf('--json');
  const jsonPath = jsonIndex === -1 ? undefined : process.argv[jsonIndex + 1];
  const selected = only === undefined ? variants : variants.filter((v) => v.id === only);

  if (selected.length === 0) {
    console.error(only === undefined ? 'the manifest is empty' : `no variant with id ${only}`);
    return 2;
  }

  const ids = new Set<string>();
  for (const variant of variants) {
    if (ids.has(variant.id)) {
      console.error(`duplicate variant id in the manifest: ${variant.id}`);
      return 2;
    }
    ids.add(variant.id);
  }

  if (process.argv.includes('--validate')) {
    const missing = selected.filter(
      (variant) => !readFileSync(join(REPO, variant.file), 'utf8').includes(variant.find),
    );
    for (const variant of missing) {
      console.error(`[${variant.id}] anchor not found in ${variant.file}`);
    }
    if (missing.length > 0) return 1;
    console.log(`mutation manifest: ${String(selected.length)} variant(s), every anchor resolves.`);
    return 0;
  }

  const results: Result[] = [];
  const baselines = new Map<string, { classification: Classification; durationMs: number }>();
  for (const variant of selected) {
    const result = await sweep(variant, baselines);
    results.push(result);
    console.log(`${result.outcome.padEnd(22)} ${variant.id}  ${variant.invariant}`);
  }

  if (reportPath !== undefined) {
    writeFileSync(resolve(reportPath), reportMarkdown(results));
    console.log(`report written to ${reportPath}`);
  }
  if (jsonPath !== undefined) {
    writeFileSync(resolve(jsonPath), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`machine-readable results written to ${jsonPath}`);
  }

  console.log('');
  for (const [outcome, count] of [...distribution(results).entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`  ${outcome.padEnd(22)} ${String(count)}`);
  }

  const notEvidence = results.filter((result) => result.outcome !== 'KILLED_ASSERTION');
  if (notEvidence.length > 0) {
    console.error('');
    console.error('Variants that did not produce evidence:');
    for (const result of notEvidence) {
      console.error(`  [${result.outcome}] ${result.variant.id}: ${result.detail}`);
      if (result.variant.note !== undefined) console.error(`      note: ${result.variant.note}`);
    }
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
