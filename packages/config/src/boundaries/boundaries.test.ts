/**
 * P02.02.07 / P02.03 — the module-boundary rules are proven by trees that violate them.
 *
 * The rules in `.dependency-cruiser.cjs` are anchored to real repository paths
 * (`^apps/server/src/modules/...`), so they cannot be exercised by a fixture parked somewhere
 * harmless. Instead each case builds a throwaway tree with those exact paths in a temporary
 * directory and cruises it with the repository's own configuration. Nothing is asserted about a
 * rule that has not been watched to fire.
 *
 * This is the half of P02.02.10 that could not be verified when the rules were written, because
 * `apps/server/src/modules/` did not exist yet.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEPCRUISE = resolve(REPO_ROOT, 'node_modules/.bin/depcruise');

const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

interface CruiseResult {
  readonly violations: readonly { readonly rule: { readonly name: string } }[];
}

/** Write `files` into a temporary tree and cruise it with the repository's real configuration. */
function cruise(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), 'moin-boundaries-'));
  workspaces.push(root);

  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }

  // Workspace packages are resolved through node_modules in the real repository (pnpm symlinks
  // them there), so the fixture tree mirrors that. Resolving `@moin/db/pool` the same way real
  // code does is the whole point of these two cases.
  for (const name of ['db', 'contracts', 'kernel', 'observability']) {
    if (!Object.keys(files).some((file) => file.startsWith(`packages/${name}/`))) continue;
    const linked = join(root, 'node_modules', '@moin', name);
    mkdirSync(dirname(linked), { recursive: true });
    symlinkSync(join(root, 'packages', name), linked, 'dir');
    writeFileSync(
      join(root, 'packages', name, 'package.json'),
      JSON.stringify({
        name: `@moin/${name}`,
        version: '0.0.0',
        type: 'module',
        exports:
          name === 'db'
            ? { '.': './src/index.ts', './pool': './src/pool.ts' }
            : { '.': './src/index.ts' },
      }),
      'utf8',
    );
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

  const targets = ['apps', 'packages'].filter((dir) =>
    Object.keys(files).some((file) => file.startsWith(`${dir}/`)),
  );

  let stdout: string;
  try {
    stdout = execFileSync(
      DEPCRUISE,
      [...targets, '--config', '.dependency-cruiser.cjs', '--output-type', 'json'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    // depcruise exits non-zero precisely when it finds violations, which is the expected path here.
    stdout = String(Reflect.get(error as object, 'stdout') ?? '');
  }
  const parsed = JSON.parse(stdout) as { summary: CruiseResult };
  return parsed.summary.violations.map((violation) => violation.rule.name);
}

describe('module boundary rules', () => {
  it('rejects a module reaching into another module’s domain layer', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/application/list-tasks.ts':
          "import { Contact } from '../../contacts/domain/contact.ts';\nexport const use = Contact;\n",
        'apps/server/src/modules/contacts/domain/contact.ts': 'export const Contact = 1;\n',
      }),
    ).toContain('no-cross-module-internals');
  });

  it('rejects a module reaching into another module’s infrastructure layer', () => {
    expect(
      cruise({
        'apps/server/src/modules/voice/application/route-call.ts':
          "import { repo } from '../../conversations/infrastructure/call-repository.ts';\nexport const use = repo;\n",
        'apps/server/src/modules/conversations/infrastructure/call-repository.ts':
          'export const repo = 1;\n',
      }),
    ).toContain('no-cross-module-internals');
  });

  it('allows a module to use another module’s published application service', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/application/create-task.ts':
          "import { resolveContact } from '../../contacts/application/resolve-contact.ts';\nexport const use = resolveContact;\n",
        'apps/server/src/modules/contacts/application/resolve-contact.ts':
          'export const resolveContact = 1;\n',
      }),
    ).not.toContain('no-cross-module-internals');
  });

  // These two use the package specifier a developer would actually type. The previous version
  // used a six-level relative path into packages/db, which no reviewer would accept and no
  // developer would write — so it "proved" a rule that could never fire on real code.
  it('rejects a module taking a raw database handle instead of using the wrapper', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/application/list-tasks.ts':
          "import { createPool } from '@moin/db/pool';\nexport const use = createPool;\n",
        'packages/db/src/pool.ts': 'export const createPool = () => 1;\n',
        'packages/db/src/index.ts': "export const PACKAGE_NAME = '@moin/db';\n",
      }),
    ).toContain('only-platform-opens-transactions');
  });

  it('allows the platform module to hold the raw handles it owns', () => {
    expect(
      cruise({
        'apps/server/src/modules/platform/infrastructure/tenant-transaction.ts':
          "import { createPool } from '@moin/db/pool';\nexport const use = createPool;\n",
        'packages/db/src/pool.ts': 'export const createPool = () => 1;\n',
        'packages/db/src/index.ts': "export const PACKAGE_NAME = '@moin/db';\n",
      }),
    ).not.toContain('only-platform-opens-transactions');
  });

  it('does not let the package barrel launder a raw handle past the rule', () => {
    // If @moin/db ever re-exported the pool, every module could take a raw handle through the
    // barrel and the rule would see only `module -> index.ts`. This is the regression test for
    // that: importing the barrel must not reach pool.ts.
    const violations = cruise({
      'apps/server/src/modules/work/application/list-tasks.ts':
        "import { PACKAGE_NAME } from '@moin/db';\nexport const use = PACKAGE_NAME;\n",
      'packages/db/src/index.ts': "export const PACKAGE_NAME = '@moin/db';\n",
      'packages/db/src/pool.ts': 'export const createPool = () => 1;\n',
    });
    expect(violations).not.toContain('only-platform-opens-transactions');
  });

  it('rejects a module domain layer reaching into its own infrastructure', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/domain/task.ts':
          "import { repo } from '../infrastructure/task-repository.ts';\nexport const use = repo;\n",
        'apps/server/src/modules/work/infrastructure/task-repository.ts':
          'export const repo = 1;\n',
      }),
    ).toContain('no-domain-imports-outward');
  });

  it('rejects an http controller reaching into infrastructure instead of an application service', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/http/task.controller.ts':
          "import { repo } from '../infrastructure/task-repository.ts';\nexport const use = repo;\n",
        'apps/server/src/modules/work/infrastructure/task-repository.ts':
          'export const repo = 1;\n',
      }),
    ).toContain('no-http-imports-repositories');
  });

  it('rejects a module reaching into another module\u2019s http layer', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/application/list-tasks.ts':
          "import { c } from '../../contacts/http/contact.controller.ts';\nexport const use = c;\n",
        'apps/server/src/modules/contacts/http/contact.controller.ts': 'export const c = 1;\n',
      }),
    ).toContain('no-cross-module-internals');
  });

  it('rejects a shared package importing an application', () => {
    expect(
      cruise({
        'packages/kernel/src/index.ts':
          "import { thing } from '../../../apps/server/src/thing.ts';\nexport const use = thing;\n",
        'apps/server/src/thing.ts': 'export const thing = 1;\n',
      }),
    ).toContain('no-app-imports-from-packages');
  });

  it('rejects the web app importing server internals', () => {
    expect(
      cruise({
        'apps/web/app/page.ts':
          "import { secret } from '../../server/src/config/env.ts';\nexport const use = secret;\n",
        'apps/server/src/config/env.ts': 'export const secret = 1;\n',
      }),
    ).toContain('web-does-not-import-server-internals');
  });

  it('rejects a circular dependency between modules', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/application/a.ts':
          "import { b } from '../../contacts/application/b.ts';\nexport const a = b;\n",
        'apps/server/src/modules/contacts/application/b.ts':
          "import { a } from '../../work/application/a.ts';\nexport const b = a;\n",
      }),
    ).toContain('no-circular');
  });

  it('catches a boundary breach smuggled through require() rather than import', () => {
    expect(
      cruise({
        'apps/server/src/modules/work/application/list-tasks.ts':
          "const { Contact } = require('../../contacts/domain/contact.ts');\nexport const use = Contact;\n",
        'apps/server/src/modules/contacts/domain/contact.ts': 'module.exports = { Contact: 1 };\n',
      }),
    ).toContain('no-cross-module-internals');
  });
});
