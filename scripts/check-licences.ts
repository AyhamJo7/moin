/**
 * Licence allowlist for production dependencies (P02.08.02, QG-11).
 *
 * The rule is narrow on purpose: **production** dependencies only. A copyleft build tool is
 * irrelevant — it is never distributed and never linked into anything shipped. A copyleft library
 * inside the runtime image is a different matter entirely, and this product is distributed as a
 * hosted service whose source stays closed.
 *
 * AGPL is the one that actually bites here. Its network clause reaches software offered over a
 * network, which is exactly what this is, so an AGPL dependency in the server would oblige us to
 * publish the source. SSPL is not an open-source licence at all and carries a similar reach.
 *
 * "Unknown" is treated as a failure rather than a warning. A dependency whose licence cannot be
 * determined is a dependency whose obligations cannot be met, and silence here is how one gets in.
 *
 *   node scripts/check-licences.ts
 *   node scripts/check-licences.ts --fixture agpl    # negative control
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Permissive licences with no obligations that conflict with a closed-source hosted service.
 *
 * Weak-copyleft file-level licences (MPL-2.0) are included: they oblige us to publish changes to
 * the licensed files themselves, which is an obligation we can meet, not a reach into our code.
 */
const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
  'Artistic-2.0',
  'BSD-3-Clause-Clear',

  // LGPL is allowed for a *hosted* service, and the distinction is the whole reason AGPL is not.
  // LGPL obligations attach on distribution of the work; running it on our own servers is not
  // distribution, and LGPL carries no network clause. The concrete case today is libvips, reached
  // through sharp, reached through Next.js image optimisation.
  //
  // This is a legal reading, so it is listed for the external review (EXT-02) rather than
  // treated as settled. If that review disagrees, the remedy is to drop Next.js image
  // optimisation, which is the only thing pulling it in.
  'LGPL-2.1',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
]);

/** Named so the failure message can say why, rather than only that the licence is not allowed. */
const REFUSED = new Map<string, string>([
  ['AGPL-1.0', 'the network clause reaches software offered over a network, which is what this is'],
  ['AGPL-3.0', 'the network clause reaches software offered over a network, which is what this is'],
  ['AGPL-3.0-only', 'the network clause reaches software offered over a network'],
  ['AGPL-3.0-or-later', 'the network clause reaches software offered over a network'],
  ['SSPL-1.0', 'not an open-source licence, and its service clause reaches a hosted offering'],
  ['GPL-2.0', 'strong copyleft; linking obliges us to publish the source'],
  ['GPL-3.0', 'strong copyleft; linking obliges us to publish the source'],
  ['GPL-3.0-only', 'strong copyleft'],
  ['GPL-3.0-or-later', 'strong copyleft'],
  ['BUSL-1.1', 'source-available with a use restriction, not an open-source licence'],
  ['Elastic-2.0', 'source-available with a use restriction'],
  ['CC-BY-NC-4.0', 'non-commercial use only'],
]);

interface Package {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
}

export interface LicenceFinding {
  readonly package: string;
  readonly licence: string;
  readonly reason: string;
}

/**
 * An SPDX expression may be a disjunction (`MIT OR GPL-3.0`), where satisfying one term is
 * enough. A conjunction (`MIT AND GPL-3.0`) requires all of them.
 */
export function evaluate(name: string, licence: string): LicenceFinding | undefined {
  const expression = licence.trim();
  if (expression === '' || /^(unknown|unlicensed|see license|custom)/i.test(expression)) {
    return {
      package: name,
      licence: expression === '' ? '(none declared)' : expression,
      reason: 'the licence cannot be determined, so its obligations cannot be met',
    };
  }

  const terms = expression
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const identifiers = terms.filter((t) => !/^(OR|AND|WITH)$/i.test(t));
  const isDisjunction = /\bOR\b/i.test(expression) && !/\bAND\b/i.test(expression);

  if (isDisjunction) {
    // Any allowed term is enough: we may choose that one.
    if (identifiers.some((id) => ALLOWED.has(id))) return undefined;
  } else if (identifiers.every((id) => ALLOWED.has(id))) {
    return undefined;
  }

  const offending = identifiers.find((id) => REFUSED.has(id)) ?? identifiers[0] ?? expression;
  return {
    package: name,
    licence: expression,
    reason: REFUSED.get(offending) ?? 'not on the allowlist for production dependencies',
  };
}

function productionPackages(): Package[] {
  // `--prod` limits this to what actually reaches the runtime image.
  const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json', '--recursive'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as Record<string, { name: string; versions: string[] }[]>;

  const packages: Package[] = [];
  for (const [licence, entries] of Object.entries(parsed)) {
    for (const entry of entries) {
      packages.push({ name: entry.name, version: entry.versions.join(', '), licence });
    }
  }
  return packages;
}

function main(): number {
  const fixtureIndex = process.argv.indexOf('--fixture');
  if (fixtureIndex !== -1) {
    // Negative control (P02.08.04): prove the check rejects what it claims to reject.
    const which = process.argv[fixtureIndex + 1] ?? 'agpl';
    const fixtures: Record<string, Package> = {
      agpl: { name: 'some-agpl-library', version: '1.0.0', licence: 'AGPL-3.0' },
      sspl: { name: 'some-sspl-library', version: '1.0.0', licence: 'SSPL-1.0' },
      unknown: { name: 'some-unlicensed-library', version: '1.0.0', licence: 'UNKNOWN' },
      gpl: { name: 'some-gpl-library', version: '1.0.0', licence: 'GPL-3.0' },
    };
    const fixture = fixtures[which];
    if (fixture === undefined) {
      console.error(`unknown fixture "${which}"; available: ${Object.keys(fixtures).join(', ')}`);
      return 2;
    }
    const finding = evaluate(fixture.name, fixture.licence);
    if (finding === undefined) {
      console.error(`FIXTURE NOT REJECTED: ${fixture.name} (${fixture.licence}) was allowed.`);
      return 1;
    }
    console.error(`${finding.package}: ${finding.licence} — ${finding.reason}`);
    console.error('\nThe fixture was rejected, which is what this control proves.');
    return 1;
  }

  const findings = productionPackages()
    .map((pkg) => evaluate(`${pkg.name}@${pkg.version}`, pkg.licence))
    .filter((finding): finding is LicenceFinding => finding !== undefined);

  if (findings.length === 0) {
    console.log('licence check: every production dependency is on the allowlist');
    return 0;
  }
  for (const finding of findings) {
    console.error(`${finding.package}: ${finding.licence} — ${finding.reason}`);
  }
  console.error(
    '\nProduction dependencies only. A copyleft build tool is fine; a copyleft library inside ' +
      'the runtime image is not, because this is a hosted service whose source stays closed. ' +
      'See docs/development/licence-policy.md.',
  );
  return 1;
}

process.exitCode = main();
