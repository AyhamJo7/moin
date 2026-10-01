/**
 * The `@moin/testing` export surface and the reach of the evidence capabilities (P06.10.07).
 *
 * `beginEvidence` opens eligibility and `confirmTerminal` vouches for a terminal value. A plain test
 * that can call both can make itself evidence — catch a matcher object, open, confirm, throw
 * anything — which an independent review reproduced while the package root re-exported them. The
 * real-Vitest replay lives in `mutation-reporter.realvitest.test.ts`; this file holds the line
 * statically and at module level:
 *
 *  1. the package's `exports` map admits the root and nothing else, so no subpath reaches inside;
 *  2. the root exports exactly an allow-list, and no capability is on it;
 *  3. even the source module, imported by relative path, exports registration and the one-shot
 *     probe handover only — `beginEvidence` and `confirmTerminal` are not exported from anywhere;
 *  4. the probe handover is already taken by the time any test runs;
 *  5. across the repository, the capability names occur only where this file says they may.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evidenceTest } from '@moin/testing';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = 'packages/testing/src/mutation/evidence-state.ts';

/** What a consumer of `@moin/testing` may import. Adding a name here is a reviewed decision. */
const PUBLIC_ROOT = [
  'InjectedFault',
  'MATCHER_IDENTITY_CONFIRMED',
  'NON_EVIDENCE',
  'PROBE_META_KEY',
  'PROBE_VERSION',
  'Seeded',
  'TEMPLATE_DATABASE',
  'asciiFold',
  'concurrentEvidenceTest',
  'createTestDatabase',
  'evidenceTest',
  'fixedClock',
  'germanPerson',
  'neverSettles',
  'slow',
  'systemClock',
  'testLandlineNumber',
  'testPhoneNumber',
  'withFault',
] as const;

/** Anything that could open eligibility, confirm a value, or write or read provenance. */
const CAPABILITIES = [
  'beginEvidence',
  'confirmTerminal',
  'installMatcherRecorder',
  'installProbe',
  'openInvocation',
  'closeInvocation',
  'matcherFailures',
  'recorded',
  'record',
  'intercept',
] as const;

function read(path: string): string {
  return readFileSync(join(REPO, path), 'utf8');
}

/** Every source file Git knows of, tracked or new, excluding ignored build output. */
function trackedSources(): string[] {
  return execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '--', '*.ts', '*.tsx', '*.mts', '*.js', '*.mjs'],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((file) => file.length > 0 && existsSync(join(REPO, file)));
}

describe('the package boundary', () => {
  evidenceTest('exports the root and no subpath', () => {
    const manifest = JSON.parse(read('packages/testing/package.json')) as Record<string, unknown>;
    // Exactly one entry, and not a pattern: `"./*"` or `"./mutation/*"` would reopen every file.
    expect(manifest['exports']).toStrictEqual({ '.': './src/index.ts' });
    expect(manifest).not.toHaveProperty('main');
    expect(manifest).not.toHaveProperty('module');
    expect(manifest).not.toHaveProperty('imports');
  });

  it('refuses every subpath a consumer might try', async () => {
    for (const specifier of [
      '@moin/testing/src/mutation/evidence-state.ts',
      '@moin/testing/src/mutation/evidence-state',
      '@moin/testing/src/index.ts',
      '@moin/testing/mutation/evidence-state',
      '@moin/testing/internal',
      '@moin/testing/probe',
    ]) {
      await expect(import(/* @vite-ignore */ specifier), specifier).rejects.toThrow();
    }
  });
});

describe('the public root', () => {
  evidenceTest('exports exactly the allow-list', async () => {
    const root = await import('@moin/testing');
    expect(Object.keys(root).sort()).toStrictEqual([...PUBLIC_ROOT].sort());
  });

  it('exports no capability, by name or by value', async () => {
    const root = (await import('@moin/testing')) as Record<string, unknown>;
    for (const name of CAPABILITIES) {
      expect(root, name).not.toHaveProperty(name);
    }
  });
});

describe('the state module itself', () => {
  evidenceTest('exports registration and the probe handover, and no capability', async () => {
    // A relative import reaches any `export` in the repository, whatever the `exports` map says.
    // So the line is drawn here, at the source: the two functions that open eligibility and vouch
    // for a value are not exported from any module at all.
    const state = (await import('../packages/testing/src/mutation/evidence-state.ts')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(state).sort()).toStrictEqual([
      'concurrentEvidenceTest',
      'evidenceTest',
      'installProbe',
    ]);
    expect(state).not.toHaveProperty('beginEvidence');
    expect(state).not.toHaveProperty('confirmTerminal');
  });

  evidenceTest(
    'has already handed the probe its capabilities, so a test cannot take them',
    async () => {
      // The probe is a setup file and runs before this module loads. A second caller is refused.
      const { installProbe } =
        (await import('../packages/testing/src/mutation/evidence-state.ts')) as {
          installProbe: () => unknown;
        };
      expect(() => installProbe()).toThrow(/already installed/u);
    },
  );

  it('is the same module instance the public wrapper uses', async () => {
    // Otherwise the probe would install into one copy of the state and the wrapper read another,
    // and nothing would ever be evidence. The relative import and the package name must agree.
    const state = (await import('../packages/testing/src/mutation/evidence-state.ts')) as Record<
      string,
      unknown
    >;
    const root = (await import('@moin/testing')) as Record<string, unknown>;
    expect(root['evidenceTest']).toBe(state['evidenceTest']);
  });
});

describe('every occurrence of a capability name in the repository', () => {
  /**
   * Where each raw capability may be named at all, with the reason. Prose in documentation and
   * evidence records is not code and is excluded by extension.
   */
  const ALLOWED: Record<string, readonly string[]> = {
    // Defined and called only inside the state module; the public wrapper's docblock describes it.
    beginEvidence: [
      STATE,
      'packages/testing/src/mutation/evidence-test.ts',
      'scripts/mutation-evidence-probe.test.ts',
      'scripts/__fixtures__/reporter/public-capability.fixture.ts',
      'scripts/testing-export-surface.test.ts',
    ],
    confirmTerminal: [
      STATE,
      'packages/testing/src/mutation/evidence-test.ts',
      'scripts/mutation-evidence-probe.test.ts',
      'scripts/mutation-reporter.ts',
      'scripts/__fixtures__/reporter/public-capability.fixture.ts',
      'scripts/testing-export-surface.test.ts',
    ],
    // Taken once, by the probe; named by the tests that prove it cannot be taken again.
    installProbe: [
      STATE,
      'packages/testing/src/index.ts',
      'packages/testing/src/mutation/evidence-test.ts',
      'scripts/mutation-evidence-probe.ts',
      'scripts/mutation-evidence-probe.test.ts',
      'scripts/__fixtures__/reporter/public-capability.fixture.ts',
      'scripts/testing-export-surface.test.ts',
    ],
    // The retired name: only the attack fixture and this file may still say it.
    installMatcherRecorder: [
      'scripts/__fixtures__/reporter/public-capability.fixture.ts',
      'scripts/testing-export-surface.test.ts',
    ],
  };

  evidenceTest('is in a file classified for it', () => {
    const files = trackedSources();
    expect(files.length).toBeGreaterThan(50);

    const unexpected: string[] = [];
    for (const file of files) {
      const source = read(file);
      for (const [name, allowed] of Object.entries(ALLOWED)) {
        if (new RegExp(`\\b${name}\\b`, 'u').test(source) && !allowed.includes(file)) {
          unexpected.push(`${file} names ${name}`);
        }
      }
    }
    expect(unexpected).toStrictEqual([]);
  });

  it('is never imported or re-exported outside the probe', () => {
    // Statements, not lines: a multi-line `import {\n  beginEvidence,\n} from …` is one statement.
    const statement = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/gu;
    const importers: string[] = [];
    for (const file of trackedSources()) {
      const source = read(file);
      for (const match of source.matchAll(statement)) {
        const names = match[1] ?? '';
        if (
          /\b(beginEvidence|confirmTerminal|installProbe|installMatcherRecorder)\b/u.test(names)
        ) {
          importers.push(file);
        }
      }
    }
    expect([...new Set(importers)]).toStrictEqual(['scripts/mutation-evidence-probe.ts']);
  });
});
