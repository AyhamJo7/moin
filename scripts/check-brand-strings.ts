/**
 * P04.07.04 — the product name is configuration, never a literal (ADR-0034).
 *
 * DG-00 is still open: the name can change after the trademark search (EXT-07), and a partner may
 * one day resell under their own. ADR-0034 says that has to be a configuration change rather than
 * a migration across templates, email footers, voice greetings and push titles — and until now the
 * enforcement for that was "review scope", which is another way of saying nobody.
 *
 * Two rules, both narrow enough to have no false positives:
 *
 * **A — the brand name is not a literal in application source.** The name is read from
 * `NEXT_PUBLIC_BRAND_NAME` in `.env.example`, so this check cannot drift from the configuration it
 * is protecting: rename the brand there and this check immediately looks for the new name.
 *
 * **B — the codename does not appear in customer-visible text.** `moin` is internal: package
 * scope, image names, log fields, Terraform resources. A caller must never hear it and a customer
 * must never read it. Rule B looks only at the files that compose text a person sees, and only
 * inside string literals, so `@moin/kernel` imports and technical identifiers are untouched.
 *
 *   node scripts/check-brand-strings.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_EXAMPLE = join(REPO_ROOT, '.env.example');

/** Source trees rule A applies to. Documentation and configuration are where the name belongs. */
const SOURCE_ROOTS = ['apps', 'packages'];

/** Trees that compose text a customer reads or hears. Rule B applies here. */
const CUSTOMER_FACING_ROOTS = [join('apps', 'web', 'app'), 'templates'];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.sql', '.html', '.txt']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  '__fixtures__',
]);

/** The codename. Internal everywhere, customer-visible nowhere. */
const CODENAME = 'moin';

/** Extensions whose whole content is customer-facing text rather than code. */
const TEXT_EXTENSIONS = new Set(['.html', '.txt']);

/** A single-, double- or backtick-quoted literal. Deliberately simple: it over-matches, never under. */
const STRING_LITERAL = /'([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*"|`([^`\\]|\\.)*`/g;

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: 'brand-literal' | 'codename-in-customer-text';
  readonly text: string;
}

/** The brand name, read from the configuration it is supposed to live in. */
export function brandName(envExamplePath: string = ENV_EXAMPLE): string {
  const text = readFileSync(envExamplePath, 'utf8');
  const name = /^NEXT_PUBLIC_BRAND_NAME=(.+)$/m.exec(text)?.[1]?.trim();
  if (name === undefined || name === '') {
    throw new Error('NEXT_PUBLIC_BRAND_NAME is not set in .env.example; ADR-0034 needs it there');
  }
  return name;
}

function walk(directory: string, files: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (SOURCE_EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

export function scan(root: string = REPO_ROOT): Violation[] {
  const brand = brandName(join(root, '.env.example'));
  const brandPattern = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const codenamePattern = new RegExp(CODENAME, 'i');
  const violations: Violation[] = [];

  const customerFacing = new Set(CUSTOMER_FACING_ROOTS.flatMap((tree) => walk(join(root, tree))));

  for (const file of new Set([
    ...SOURCE_ROOTS.flatMap((tree) => walk(join(root, tree))),
    ...customerFacing,
  ])) {
    const relativePath = relative(root, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      // Rule A: the brand name anywhere in application source.
      if (brandPattern.test(line)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: 'brand-literal',
          text: line.trim(),
        });
      }
      // Rule B: the codename in customer-facing text.
      if (!customerFacing.has(file)) return;
      // In code, only string literals are text a person sees; in a template, the whole line is.
      // Treating a template as code was the first version of this check, and it passed a file
      // whose body read "Ihr Team von Moin" — the exact thing the rule exists to stop.
      const isTemplate = TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf('.')));
      const candidates = isTemplate ? [line] : (line.match(STRING_LITERAL) ?? []);
      for (const match of candidates) {
        // `@moin/...` is the package scope, which is internal by definition.
        if (match.includes('@moin/')) continue;
        if (codenamePattern.test(match)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            rule: 'codename-in-customer-text',
            text: line.trim(),
          });
        }
      }
    });
  }
  return violations;
}

function main(): number {
  const violations = scan();
  if (violations.length === 0) {
    console.log(
      `brand strings: no literal "${brandName()}" in application source, ` +
        `and no "${CODENAME}" in customer-facing text (ADR-0034).`,
    );
    return 0;
  }
  console.error('Brand and codename literals (ADR-0034, P04.07.04):');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${String(violation.line)} [${violation.rule}]`);
    console.error(`    ${violation.text}`);
  }
  console.error(
    '\n  The product name is configuration: NEXT_PUBLIC_BRAND_NAME, read once and passed down.\n' +
      '  DG-00 is still open, so a rename must stay a configuration change.\n',
  );
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
