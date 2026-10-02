/**
 * `identity-is-api-only` (P06.06, ADR-0003 amendment), watched to fire.
 *
 * The sign-in and session code runs behind `moin_identity`, a credential only the api holds. The
 * boundary rule keeps the identity module and its pool out of the voice, worker and migrate graphs,
 * including transitively. Like every rule in `.dependency-cruiser.cjs` it is anchored to real
 * repository paths, so each case writes a throwaway tree with those paths and cruises it with the
 * repository's own configuration (the method of `packages/config/src/boundaries/boundaries.test.ts`).
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceTest } from '@moin/testing';
import { afterAll, describe, expect } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPCRUISE = resolve(REPO_ROOT, 'node_modules/.bin/depcruise');
const RULE = 'identity-is-api-only';
const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function violations(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), 'moin-identity-boundary-'));
  workspaces.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }
  copyFileSync(
    resolve(REPO_ROOT, '.dependency-cruiser.cjs'),
    join(root, '.dependency-cruiser.cjs'),
  );
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      include: ['**/*.ts'],
    }),
    'utf8',
  );
  let stdout: string;
  try {
    stdout = execFileSync(
      DEPCRUISE,
      ['apps', '--config', '.dependency-cruiser.cjs', '--output-type', 'json'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // depcruise exits non-zero precisely when it finds violations, which is the expected path.
    stdout = String(Reflect.get(error as object, 'stdout') ?? '');
  }
  const parsed = JSON.parse(stdout) as {
    summary: { violations: { rule: { name: string } }[] };
  };
  return parsed.summary.violations.map((violation) => violation.rule.name);
}

describe('identity is api-only', () => {
  evidenceTest('rejects the voice role reaching the identity module through another module', () => {
    expect(
      violations({
        'apps/server/src/main-voice.ts':
          "import { Voice } from './roots/voice-root.module.ts';\nexport const use = Voice;\n",
        'apps/server/src/roots/voice-root.module.ts':
          "import { Calls } from '../modules/voice/voice.module.ts';\nexport const Voice = Calls;\n",
        'apps/server/src/modules/voice/voice.module.ts':
          "import { Identity } from '../identity-access/identity-access.module.ts';\nexport const Calls = Identity;\n",
        'apps/server/src/modules/identity-access/identity-access.module.ts':
          'export const Identity = 1;\n',
      }),
    ).toContain(RULE);
  });

  evidenceTest('rejects the worker role importing the identity pool', () => {
    expect(
      violations({
        'apps/server/src/roots/worker-root.module.ts':
          "import { IdentityPool } from '../modules/platform/identity-pool.module.ts';\nexport const Worker = IdentityPool;\n",
        'apps/server/src/modules/platform/identity-pool.module.ts':
          'export const IdentityPool = 1;\n',
      }),
    ).toContain(RULE);
  });

  evidenceTest('allows the api role to import the identity module', () => {
    expect(
      violations({
        'apps/server/src/roots/api-root.module.ts':
          "import { Identity } from '../modules/identity-access/identity-access.module.ts';\nexport const Api = Identity;\n",
        'apps/server/src/modules/identity-access/identity-access.module.ts':
          'export const Identity = 1;\n',
      }),
    ).not.toContain(RULE);
  });
});
