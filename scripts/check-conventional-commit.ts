/**
 * P02.01.03: PR titles and commit subjects follow Conventional Commits.
 *
 * Deliberately stricter than the specification in three places, because the repository conventions
 * in CONTRIBUTING.md are stricter:
 *
 *   - the type must be one of the allowed set, not any word;
 *   - the subject is lower-case and has no trailing full stop, so `main`'s history reads uniformly;
 *   - a breaking change must be marked `!`, so it cannot hide in a body nobody reads.
 *
 *   node scripts/check-conventional-commit.ts --title "feat(voice): hold the call open"
 *   node scripts/check-conventional-commit.ts --commits origin/main..HEAD
 *   node scripts/check-conventional-commit.ts --self-test
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = [
  'feat',
  'fix',
  'chore',
  'docs',
  'test',
  'refactor',
  'perf',
  'build',
  'ci',
  'style',
  'revert',
] as const;

const MAX_SUBJECT_LENGTH = 72;
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\(([a-z0-9][a-z0-9._-]*)\\))?(!)?: (.+)$`);

export function checkTitle(title: string): string[] {
  const problems: string[] = [];
  const subject = title.split('\n')[0] ?? '';

  // A revert produced by `git revert` keeps the reverted subject in quotes; accept that shape.
  if (/^Revert "/.test(subject)) return problems;

  const match = HEADER.exec(subject);
  if (match === null) {
    problems.push(
      `not a Conventional Commit header: ${JSON.stringify(subject)}. ` +
        `Expected "type(scope): subject" with type in {${TYPES.join(', ')}}`,
    );
    return problems;
  }

  const text = match[5] ?? '';
  if (subject.length > MAX_SUBJECT_LENGTH) {
    problems.push(`subject is ${subject.length} characters; keep it within ${MAX_SUBJECT_LENGTH}`);
  }
  if (/[.!?]$/.test(text)) {
    problems.push('subject ends with punctuation; drop the final full stop');
  }
  if (/^[A-Z][a-z]/.test(text)) {
    problems.push('subject starts with a capital letter; use lower case');
  }
  if (text.trim().length === 0) {
    problems.push('subject is empty');
  }
  return problems;
}

interface Case {
  readonly title: string;
  readonly valid: boolean;
}

const CASES: readonly Case[] = [
  { title: 'feat(voice): hold the call open while the tool result is pending', valid: true },
  { title: 'chore: add development control plane for phase execution', valid: true },
  { title: 'feat(db)!: move tenant context into the connection wrapper', valid: true },
  { title: 'docs(plan): add master execution plan baseline', valid: true },
  { title: 'Revert "feat(voice): hold the call open"', valid: true },
  { title: 'fix(identity-access): reject a session whose tenant no longer exists', valid: true },
  { title: 'added a thing', valid: false },
  { title: 'Feat(voice): hold the call open', valid: false },
  { title: 'feat(voice) hold the call open', valid: false },
  { title: 'wip: poke at the dialogue manager', valid: false },
  { title: 'feat(voice): Hold the call open', valid: false },
  { title: 'feat(voice): hold the call open.', valid: false },
  { title: 'feat: ', valid: false },
];

function commitSubjects(range: string): string[] {
  let out: string;
  try {
    out = execFileSync('git', ['log', '--format=%s', range], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // A CI check that dies with a stack trace tells the reader nothing useful.
    throw new Error(`cannot read commits for range ${JSON.stringify(range)}: no such revision range`);
  }
  return out.split('\n').filter((line) => line.trim().length > 0);
}

function main(): number {
  const argv = process.argv.slice(2);
  const titles: string[] = [];
  let runSelfTest = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--self-test') {
      runSelfTest = true;
    } else if (arg === '--title') {
      if (value === undefined) throw new Error('--title needs a value');
      titles.push(value);
      i += 1;
    } else if (arg === '--commits') {
      if (value === undefined) throw new Error('--commits needs a revision range');
      titles.push(...commitSubjects(value));
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (runSelfTest) {
    const failures = CASES.filter((c) => (checkTitle(c.title).length === 0) !== c.valid);
    if (failures.length > 0) {
      console.error('conventional-commit self-test failed:');
      for (const c of failures) {
        console.error(`  - expected ${c.valid ? 'valid' : 'invalid'}: ${JSON.stringify(c.title)}`);
      }
      return 1;
    }
    console.log(`conventional-commit self-test passed: ${CASES.length} cases`);
  }

  if (titles.length === 0) {
    if (runSelfTest) return 0;
    console.error('nothing to check: pass --title, --commits or --self-test');
    return 2;
  }

  let failed = false;
  for (const title of titles) {
    for (const problem of checkTitle(title)) {
      failed = true;
      console.error(`${JSON.stringify(title.split('\n')[0])}: ${problem}`);
    }
  }
  if (failed) {
    console.error('\nSee CONTRIBUTING.md → Commits.');
    return 1;
  }
  console.log(`conventional-commit: ${titles.length} title(s) clean`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`check-conventional-commit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
