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

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  baselineIsUsable,
  classifyRun,
  type Classification,
  type KillingTest,
  type MutationOutcome,
  type MutationReport,
} from './mutation-outcome.ts';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'docs', 'verification', 'audit-mutation-manifest.json');

/** The tree the baselines in this process were measured against. */
function headSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    // No git, or a detached worktree: fall back to a value that shares nothing, so nothing caches.
    return `unknown-${String(process.pid)}`;
  }
}
const TEST_TIMEOUT_MS = 1_200_000;

/** Turns a full test name into a literal regular expression. */
function escapeForFilter(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** The outcome of trying to inject one variant into a source file. */
export type MutationApplication =
  { readonly ok: true; readonly source: string } | { readonly ok: false; readonly reason: string };

/**
 * Inject one variant, or refuse.
 *
 * Two rules, both enforced **here** rather than only in `--validate`, because an operator who
 * skips validation must not get a weaker guarantee than one who does not:
 *
 *  1. the anchor must occur **exactly once**. A two-place anchor used to mutate whichever occurred
 *     first, so which guard a variant attacked was decided by file order — one manifest entry was
 *     in that state and was only correct by luck;
 *  2. the replacement must differ from the anchor, or the "mutant" is the pristine tree and any
 *     kill it reports is meaningless.
 *
 * The splice is positional rather than `String.prototype.replace`, which interprets its
 * replacement: `$$` means a literal `$`, so every variant whose replacement contained a SQL
 * function body was silently corrupted into `AS $` and the migration failed with a syntax error.
 * The variant looked detected; nothing had been tested. A positional splice interprets nothing.
 */
export function applyMutation(source: string, find: string, replace: string): MutationApplication {
  if (find.length === 0) {
    return { ok: false, reason: 'the anchor is empty, so it does not identify a place to mutate' };
  }
  if (replace === find) {
    return {
      ok: false,
      reason: 'the replacement is identical to the anchor, so the mutant is the pristine tree',
    };
  }
  const occurrences = source.split(find).length - 1;
  if (occurrences === 0) {
    return { ok: false, reason: 'the anchor is not present' };
  }
  if (occurrences > 1) {
    return {
      ok: false,
      reason: `the anchor occurs ${String(occurrences)} times, so which one is mutated is arbitrary`,
    };
  }
  const index = source.indexOf(find);
  return { ok: true, source: source.slice(0, index) + replace + source.slice(index + find.length) };
}

interface Variant {
  readonly id: string;
  readonly invariant: string;
  readonly expected: string;
  /** File the defect is injected into, relative to the repository root. */
  readonly file: string;
  /** Exact text to replace. The sweep fails loudly if it is absent. */
  readonly find: string;
  readonly replace: string;
  /**
   * The one test that must catch this defect, named exactly.
   *
   * A file **and** a full name, both compared exactly. Matching by substring was unsound in three
   * separate ways: a same-named test in another file could claim the kill, two tests could match at
   * once, and `"rejects invalid chain"` matched `"rejects invalid chain after retry"`.
   */
  readonly killingTest: KillingTest;
  /**
   * Which Vitest project the killing test belongs to. Defaults to `integration`.
   *
   * The harness's own controls live in the unit project — a classifier that needed a database to
   * prove it rejects a database failure would be a poor joke — so the project is per variant.
   */
  readonly project?: 'unit' | 'integration';
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
        variant.project ?? 'integration',
        variant.killingTest.file,
        '-t',
        // Anchored and escaped, so the filter selects the intended test and not a longer name that
        // contains it. Vitest treats `-t` as a regular expression against the full name.
        `^${escapeForFilter(variant.killingTest.fullName)}$`,
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
    classification: classifyRun({ report, timedOut, exitCode, output, phase }, variant.killingTest),
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
  // Refused before the baseline runs: an unapplicable variant proves nothing, and its baseline
  // would be a wasted integration run.
  const applied = applyMutation(original, variant.find, variant.replace);
  if (!applied.ok) {
    return {
      variant,
      baseline: 'BASELINE_FAILED',
      outcome: 'INVALID_MUTANT',
      detail: `the variant could not be applied to ${variant.file}: ${applied.reason}`,
      matched: 0,
      unrelatedFailures: 0,
      baselineMs: 0,
      mutantMs: 0,
    };
  }

  // The cache key is everything that determines the baseline: the tree it was measured against,
  // the project, the file and the exact test name. A looser key would let one variant's baseline
  // vouch for another's.
  const key = [
    headSha(),
    variant.project ?? 'integration',
    variant.killingTest.file,
    variant.killingTest.fullName,
  ].join('\u0000');
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
    writeFileSync(path, applied.source);
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
          `\`${result.variant.killingTest.file}\` — “${result.variant.killingTest.fullName}”`,
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
    const problems: string[] = [];

    for (const variant of selected) {
      const identity = variant.killingTest as KillingTest | undefined;
      if (
        identity === undefined ||
        typeof identity.file !== 'string' ||
        identity.file.length === 0 ||
        typeof identity.fullName !== 'string' ||
        identity.fullName.length === 0
      ) {
        problems.push(`[${variant.id}] killingTest must name a file and an exact fullName`);
        continue;
      }
      if (!existsSync(join(REPO, identity.file))) {
        problems.push(`[${variant.id}] killingTest.file does not exist: ${identity.file}`);
      }
      if (!existsSync(join(REPO, variant.file))) {
        problems.push(`[${variant.id}] the mutated file does not exist: ${variant.file}`);
        continue;
      }
      // The same function the sweep applies with, so validation can be neither more permissive
      // than execution nor less.
      const applied = applyMutation(
        readFileSync(join(REPO, variant.file), 'utf8'),
        variant.find,
        variant.replace,
      );
      if (!applied.ok) {
        problems.push(`[${variant.id}] ${variant.file}: ${applied.reason}`);
      }
    }

    // Static name resolution. `vitest list` collects without running, which is cheap and exact —
    // except for table-driven tests, whose names are built at run time, so the collector reports
    // the literal template. Those are reported as deferred rather than failed, and the baseline
    // gate enforces uniqueness for real: it requires exactly one match or it refuses the variant.
    const deferred: string[] = [];
    const filesToCheck = new Map<string, Set<string>>();
    for (const variant of selected) {
      const project = variant.project ?? 'integration';
      const key = `${project}\u0000${variant.killingTest.file}`;
      filesToCheck.set(key, (filesToCheck.get(key) ?? new Set()).add(variant.killingTest.fullName));
    }
    for (const [key, wanted] of filesToCheck) {
      const [project = 'integration', file = ''] = key.split('\u0000');
      let collected: string[];
      try {
        const listed = execFileSync(
          process.execPath,
          ['./node_modules/vitest/vitest.mjs', 'list', '--project', project, file, '--json'],
          {
            cwd: REPO,
            encoding: 'utf8',
            maxBuffer: MAX_OUTPUT_BYTES,
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        );
        collected = (JSON.parse(listed) as { name?: string }[]).map((entry) => entry.name ?? '');
      } catch {
        problems.push(`[${file}] could not be collected by \`vitest list\` in project ${project}`);
        continue;
      }
      const dynamic = collected.some((name) => name.includes('${'));
      for (const name of wanted) {
        const matches = collected.filter((candidate) => candidate === name).length;
        if (matches === 1) continue;
        if (matches > 1) {
          problems.push(
            `[${file}] defines "${name}" ${String(matches)} times, so no variant can name it`,
          );
        } else if (dynamic) {
          deferred.push(`${file} :: "${name}" (built at run time; confirmed by the baseline)`);
        } else {
          problems.push(`[${file}] has no test named exactly "${name}"`);
        }
      }
    }

    for (const problem of problems) console.error(problem);
    if (problems.length > 0) return 1;
    for (const entry of deferred) console.log(`deferred: ${entry}`);
    console.log(
      `mutation manifest: ${String(selected.length)} variant(s); every anchor resolves and every ` +
        `killing test is named exactly${deferred.length > 0 ? `, ${String(deferred.length)} confirmed at baseline` : ''}.`,
    );
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
