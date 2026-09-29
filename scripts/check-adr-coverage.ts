/**
 * ADR coverage (P03.01.04, P03.01.05, P03.08.02).
 *
 * Two questions, both of which are easy to answer wrongly by reading:
 *
 * **Does every ADR name how it is enforced?** A decision nobody checks is a decision that drifts.
 * The Verification section is mandatory, and "mandatory" means a script fails without it, not that
 * the template suggests it.
 *
 * **Does every invariant have an ADR behind it?** An invariant with no recorded decision is one
 * whose reasoning exists only in PLAN.md's one-line summary — and that is not enough to tell
 * whether a future change violates it.
 *
 *   node scripts/check-adr-coverage.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
const PLAN = join(REPO_ROOT, 'PLAN.md');
const ADR_INDEX = join(ADR_DIR, 'README.md');

const ADR_FILE = /^(\d{4})-[a-z0-9-]+\.md$/;
const INV_IN_PLAN = /^\| (INV-\d{2}) \| (.+?) \|/gm;
const STATUS = /^- \*\*Status:\*\*\s*(ACCEPTED|PROPOSED|SUPERSEDED|DEFERRED)/m;

export interface Adr {
  readonly id: string;
  readonly number: string;
  readonly file: string;
  readonly status: string;
  readonly hasVerification: boolean;
  readonly invariants: readonly string[];
}

export function loadAdrs(directory: string = ADR_DIR): Adr[] {
  return readdirSync(directory)
    .filter((name) => ADR_FILE.test(name))
    .sort()
    .map((file) => {
      const text = readFileSync(join(directory, file), 'utf8');
      const number = ADR_FILE.exec(file)?.[1] ?? '';
      const verification = text.split(/^## Verification\s*$/m)[1] ?? '';
      return {
        id: `ADR-${number}`,
        number,
        file,
        status: STATUS.exec(text)?.[1] ?? 'UNKNOWN',
        // A heading alone is not a verification. It must name something: a table row counts.
        hasVerification: /\|\s*\S+.*\|\s*\S+.*\|/.test(verification),
        invariants: [...new Set(text.match(/INV-\d{2}/g) ?? [])].sort(),
      };
    });
}

/** Invariants declared in PLAN.md's invariant table. */
export function planInvariants(planPath: string = PLAN): string[] {
  const text = readFileSync(planPath, 'utf8');
  return [...new Set([...text.matchAll(INV_IN_PLAN)].map((m) => m[1] ?? ''))].sort();
}

export interface Coverage {
  readonly adrsWithoutVerification: string[];
  readonly invariantsWithoutAdr: string[];
  readonly adrs: number;
  readonly adrsMissingFromIndex: string[];
  readonly indexEntriesWithoutFile: string[];
}

const REGISTER = join(REPO_ROOT, 'docs', 'architecture', 'invariant-enforcement.md');

/**
 * Invariants the enforcement register explicitly accounts for without an ADR yet.
 *
 * The exemption is deliberately narrow: the register must name the invariant under the heading
 * that explains why, so a gap is a recorded decision rather than an omission nobody noticed.
 */
export function registeredWithoutAdr(registerPath: string = REGISTER): Set<string> {
  let text: string;
  try {
    text = readFileSync(registerPath, 'utf8');
  } catch {
    return new Set();
  }
  const section = text.split(/^## Invariants whose ADR is in a later phase\s*$/m)[1] ?? '';
  return new Set(section.match(/INV-\d{2}/g) ?? []);
}

/**
 * ADR numbers the index in `docs/adr/README.md` links to.
 *
 * This check was missing, and its absence was found the honest way: two ADRs were added, every
 * check passed, and neither appeared in the index. An index nobody verifies is a list that is
 * right on the day it is written.
 */
export function indexedAdrs(indexPath: string = ADR_INDEX): Set<string> {
  const text = readFileSync(indexPath, 'utf8');
  const linked = new Set<string>();
  for (const match of text.matchAll(/\]\((\d{4})-[a-z0-9-]+\.md\)/g)) {
    const number = match[1];
    if (number !== undefined) linked.add(number);
  }
  return linked;
}

export function coverage(directory?: string, planPath?: string): Coverage {
  const adrs = loadAdrs(directory);
  const covered = new Set(adrs.flatMap((adr) => adr.invariants));
  const excused = registeredWithoutAdr();
  const indexed = indexedAdrs();
  return {
    adrsWithoutVerification: adrs
      .filter((a) => !a.hasVerification)
      .map((a) => `${a.id} (${a.file})`),
    invariantsWithoutAdr: planInvariants(planPath).filter(
      (inv) => !covered.has(inv) && !excused.has(inv),
    ),
    adrs: adrs.length,
    adrsMissingFromIndex: adrs.filter((a) => !indexed.has(a.number)).map((a) => a.file),
    indexEntriesWithoutFile: [...indexed]
      .filter((number) => !adrs.some((a) => a.number === number))
      .sort(),
  };
}

function main(): number {
  const result = coverage();
  let failed = false;

  if (result.adrsWithoutVerification.length > 0) {
    failed = true;
    console.error('ADRs with no Verification section naming an enforcement:');
    for (const adr of result.adrsWithoutVerification) console.error(`  - ${adr}`);
    console.error('  A decision nobody checks is a decision that drifts (P03.01.04).\n');
  }

  if (result.invariantsWithoutAdr.length > 0) {
    failed = true;
    console.error('Invariants with no ADR referencing them:');
    for (const inv of result.invariantsWithoutAdr) console.error(`  - ${inv}`);
    console.error(
      '  Each invariant needs a recorded decision behind it, or an explicit note in the\n' +
        '  enforcement register saying which phase will write one (P03.01.05, P03.08.02).\n',
    );
  }

  if (result.adrsMissingFromIndex.length > 0) {
    failed = true;
    console.error('ADR files the index in docs/adr/README.md does not link to:');
    for (const file of result.adrsMissingFromIndex) console.error(`  - ${file}`);
    console.error(
      '  An index nobody verifies is a list that is right on the day it was written.\n',
    );
  }

  if (result.indexEntriesWithoutFile.length > 0) {
    failed = true;
    console.error('Index entries with no ADR file behind them:');
    for (const number of result.indexEntriesWithoutFile) console.error(`  - ADR-${number}`);
    console.error('');
  }

  if (failed) return 1;
  console.log(
    `ADR coverage: ${String(result.adrs)} ADRs, every one names an enforcement; ` +
      'every invariant is referenced by at least one ADR; the index lists every file.',
  );
  return 0;
}

process.exitCode = main();
