/**
 * P02.02.10 — every lint ban is proven by a fixture that violates it.
 *
 * A lint rule nobody has seen fail is indistinguishable from a rule that does not fire. Each
 * fixture in `__fixtures__/` breaks exactly one ban; this test asserts the ban reports it, and
 * that the fixture set as a whole is clean of nothing — a fixture that stops violating its rule
 * fails here rather than silently reducing coverage.
 *
 * The two `moin/*` rules are off in the shared config until P06.03, so they are switched on
 * explicitly here: the rule logic must be under test long before it guards production code.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { baseConfig } from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '__fixtures__');

/** fixture file -> the rule that must report it. */
const EXPECTED: Record<string, string> = {
  'explicit-any.ts': '@typescript-eslint/no-explicit-any',
  'default-export.ts': 'no-restricted-syntax',
  'dangerous-html.tsx': 'no-restricted-syntax',
  'sql-template.ts': 'no-restricted-syntax',
  'sql-concat.ts': 'no-restricted-syntax',
  'session-set.ts': 'no-restricted-syntax',
  'console-log.ts': 'no-console',
  'floating-promise.ts': '@typescript-eslint/no-floating-promises',
  'tenant-conditional.ts': 'moin/no-tenant-conditional',
  'direct-db-access.ts': 'moin/no-direct-db-access',
};

function eslintFor(): ESLint {
  return new ESLint({
    cwd: FIXTURES,
    ignore: false,
    overrideConfigFile: true,
    overrideConfig: [
      ...baseConfig,
      {
        languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: FIXTURES } },
        rules: {
          'moin/no-tenant-conditional': 'error',
          'moin/no-direct-db-access': 'error',
        },
      },
    ],
  });
}

describe('lint bans (P02.02.10)', () => {
  it('has one fixture on disk for every expected ban, and no unclaimed fixture', () => {
    const onDisk = readdirSync(FIXTURES)
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .sort();
    expect(onDisk).toStrictEqual(Object.keys(EXPECTED).sort());
  });

  for (const [fixture, ruleId] of Object.entries(EXPECTED)) {
    it(`${fixture} is reported by ${ruleId}`, async () => {
      const results = await eslintFor().lintFiles([resolve(FIXTURES, fixture)]);
      const reported = results.flatMap((r) => r.messages).map((m) => m.ruleId);
      expect(reported, `${fixture} produced: ${JSON.stringify(reported)}`).toContain(ruleId);
    });
  }
});
