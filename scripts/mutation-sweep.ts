/**
 * The mutation sweep (QG-09 negative controls, P06.10.07).
 *
 * ## Why this exists as a committed tool rather than a one-off script
 *
 * A test that has never been made to fail is a hope, not a control. Every guard in the audit
 * subsystem therefore has at least one *defective variant*: a named, minimal edit that would
 * reintroduce the defect the guard exists to prevent. This applies each variant to the working
 * tree, runs only the test that must catch it, requires a non-zero exit, and restores the file
 * byte-for-byte.
 *
 * The manifest is data (`docs/verification/audit-mutation-manifest.json`) so the set is
 * *inspectable*: each entry names the invariant it targets, what failure is expected, and which
 * test kills it. A total count alone ("42 killed") tells a reviewer nothing about coverage.
 *
 * A variant that SURVIVES is not a code defect — it means the test is weaker than it looks. That
 * has been the outcome every time it has happened here, which is the argument for keeping this.
 *
 *   node scripts/mutation-sweep.ts --validate     # anchors resolve; changes nothing, runs nothing
 *   node scripts/mutation-sweep.ts                # the full sweep
 *   node scripts/mutation-sweep.ts --only B4-1    # one variant
 *   node scripts/mutation-sweep.ts --report out.md
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(REPO, 'docs', 'verification', 'audit-mutation-manifest.json');
const TEST_TIMEOUT_MS = 1_200_000;

interface Variant {
  /** Stable identifier, cited in evidence records. */
  readonly id: string;
  /** The invariant or property this variant attacks. */
  readonly invariant: string;
  /** What the defect would cause if it shipped. */
  readonly expected: string;
  /** File the defect is injected into, relative to the repository root. */
  readonly file: string;
  /** Exact text to replace. The sweep fails loudly if it is absent. */
  readonly find: string;
  /** Replacement text. */
  readonly replace: string;
  /** Test file that must catch it. */
  readonly test: string;
  /** Vitest `-t` filter naming the killing test. */
  readonly kills: string;
}

type Verdict = 'KILLED' | 'SURVIVED' | 'ANCHOR-MISSING' | 'NO-TEST-MATCHED';

function manifest(): readonly Variant[] {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('mutation manifest is not an array');
  return parsed as readonly Variant[];
}

/** Applies one variant, runs its killing test, restores the file, and reports the verdict. */
async function sweep(variant: Variant): Promise<Verdict> {
  const path = join(REPO, variant.file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(variant.find)) return 'ANCHOR-MISSING';

  try {
    writeFileSync(path, original.replace(variant.find, variant.replace));
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
        ],
        { cwd: REPO, timeout: TEST_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      );
      // Exit 0 with no matching test is a manifest error, not a surviving defect.
      return `${stdout}${stderr}`.includes('No test found') ? 'NO-TEST-MATCHED' : 'SURVIVED';
    } catch {
      return 'KILLED';
    }
  } finally {
    // Restored from memory rather than from git, so a sweep can never depend on a clean tree and
    // can never be mistaken for a revert.
    writeFileSync(path, original);
  }
}

function reportMarkdown(results: readonly (readonly [Variant, Verdict])[]): string {
  const rows = results
    .map(
      ([variant, verdict]) =>
        `| \`${variant.id}\` | ${variant.invariant} | ${variant.expected} | \`${variant.test}\` — “${variant.kills}” | **${verdict}** |`,
    )
    .join('\n');
  const killed = results.filter(([, verdict]) => verdict === 'KILLED').length;
  return [
    `# Audit mutation sweep — ${String(killed)}/${String(results.length)} KILLED`,
    '',
    '| Variant | Invariant targeted | Expected failure if it shipped | Test that kills it | Verdict |',
    '| --- | --- | --- | --- | --- |',
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

  const results: (readonly [Variant, Verdict])[] = [];
  for (const variant of selected) {
    const verdict = await sweep(variant);
    results.push([variant, verdict]);
    console.log(`${verdict.padEnd(15)} ${variant.id}  ${variant.invariant}`);
  }

  if (reportPath !== undefined) {
    writeFileSync(resolve(reportPath), reportMarkdown(results));
    console.log(`report written to ${reportPath}`);
  }

  const survivors = results.filter(([, verdict]) => verdict !== 'KILLED');
  if (survivors.length > 0) {
    console.error('');
    console.error('Variants not killed — the test is weaker than it looks, not the code:');
    for (const [variant, verdict] of survivors) {
      console.error(`  [${verdict}] ${variant.id}: ${variant.expected}`);
    }
    return 1;
  }
  console.log(`\nall ${String(results.length)} variant(s) KILLED.`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
