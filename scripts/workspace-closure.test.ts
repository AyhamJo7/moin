import { describe, expect } from 'vitest';
import { evidenceTest } from '@moin/testing';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');

function closureOfServer(): { listed: string[]; out: string } {
  const out = mkdtempSync(join(tmpdir(), 'moin-closure-'));
  const stdout = execFileSync(
    process.execPath,
    ['scripts/workspace-closure.ts', 'apps/server', out],
    { cwd: REPO, encoding: 'utf8' },
  );
  return { listed: stdout.split('\n').filter((line) => line !== ''), out };
}

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

describe('the server image ships the workspace packages the server imports (P02.03)', () => {
  evidenceTest('every workspace package the server depends on at run time is listed', () => {
    const { listed } = closureOfServer();
    const server = JSON.parse(
      readFileSync(join(REPO, 'apps/server/package.json'), 'utf8'),
    ) as Manifest;
    const direct = Object.keys(server.dependencies ?? {}).filter((name) =>
      name.startsWith('@moin/'),
    );
    // The names that broke the voice and worker roles are among them.
    for (const name of ['@moin/telephony', '@moin/integrations']) expect(direct).toContain(name);
    const dirs = new Set(listed);
    for (const name of direct) {
      const dir = `packages/${name.replace('@moin/', '')}`;
      expect(dirs.has(dir), `${name} is a run-time dependency but not in the closure`).toBe(true);
    }
  });

  evidenceTest('development-only workspace packages never reach the image', () => {
    const { listed } = closureOfServer();
    const server = JSON.parse(
      readFileSync(join(REPO, 'apps/server/package.json'), 'utf8'),
    ) as Manifest;
    for (const name of Object.keys(server.devDependencies ?? {})) {
      if (!name.startsWith('@moin/')) continue;
      expect(listed, `${name} is a devDependency`).not.toContain(
        `packages/${name.replace('@moin/', '')}`,
      );
    }
  });

  evidenceTest('transitive workspace dependencies are followed', () => {
    const { listed } = closureOfServer();
    for (const dir of listed) {
      const manifest = JSON.parse(
        readFileSync(join(REPO, dir, 'package.json'), 'utf8'),
      ) as Manifest;
      for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
        if (!spec.startsWith('workspace:')) continue;
        expect(listed, `${dir} needs ${name}`).toContain(`packages/${name.replace('@moin/', '')}`);
      }
    }
  });

  evidenceTest('the manifests are written for the root and every listed package', () => {
    const { listed, out } = closureOfServer();
    for (const dir of ['apps/server', ...listed]) {
      expect(() => readFileSync(join(out, 'manifests', dir, 'package.json'))).not.toThrow();
    }
    expect(
      readFileSync(join(out, 'packages.txt'), 'utf8').split('\n').filter(Boolean),
    ).toStrictEqual(listed);
  });
});
