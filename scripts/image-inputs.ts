/**
 * Whether a change can alter the server image (P02.06.03 as amended 2026-11-14, ROADMAP C3).
 *
 * The image is built from the repository with `.dockerignore` applied, so a path is an image input
 * exactly when `.dockerignore` does not exclude it. That file is the list; nothing here repeats it.
 * The container-scan workflow itself is an input too: it is excluded from the build context but
 * defines what the job checks.
 *
 * On a pull request the workflow builds and scans only when this answers true. Both checks still
 * report either way, and pushes to `main` and the daily scheduled scan always build and scan.
 *
 *   node scripts/image-inputs.ts --base <sha> --head <sha>   # prints and writes image=true|false
 *
 * When the diff cannot be computed the answer is true: an unknown change is scanned.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_WORKFLOW = '.github/workflows/container-scan.yml';

export interface IgnoreRule {
  readonly pattern: string;
  readonly negated: boolean;
}

/** The rules of a `.dockerignore`, in order; blank lines and comments dropped. */
export function parseDockerignore(text: string): IgnoreRule[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) =>
      line.startsWith('!')
        ? { pattern: line.slice(1).replace(/^\/+/, ''), negated: true }
        : { pattern: line.replace(/^\/+/, ''), negated: false },
    );
}

/**
 * Docker's reading: a rule that matches the path or any directory above it applies, and the last
 * rule that applies wins, so `!README.md` after `*.md` keeps the root README in the context.
 */
export function excluded(path: string, rules: readonly IgnoreRule[]): boolean {
  const segments = path.split('/');
  const candidates = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
  let result = false;
  for (const rule of rules) {
    if (candidates.some((candidate) => matchesGlob(candidate, rule.pattern))) {
      result = !rule.negated;
    }
  }
  return result;
}

/** True when any changed path reaches the build context or is the scan workflow itself. */
export function touchesImage(paths: readonly string[], rules: readonly IgnoreRule[]): boolean {
  return paths.some((path) => path === SCAN_WORKFLOW || !excluded(path, rules));
}

function changedPaths(base: string, head: string): string[] | undefined {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--no-renames', `${base}...${head}`],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    return output.split('\n').filter((line) => line !== '');
  } catch {
    return undefined;
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const base = argument('--base');
  const head = argument('--head');
  const paths = base !== undefined && head !== undefined ? changedPaths(base, head) : undefined;
  const rules = parseDockerignore(readFileSync(resolve(REPO_ROOT, '.dockerignore'), 'utf8'));
  const image = paths === undefined ? true : touchesImage(paths, rules);
  const reason =
    paths === undefined
      ? 'the change could not be listed, so it is treated as an image input'
      : `${String(paths.length)} changed path(s)`;
  console.log(`image=${String(image)} (${reason})`);
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output !== '') appendFileSync(output, `image=${String(image)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
