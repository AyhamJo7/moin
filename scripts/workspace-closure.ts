/**
 * The workspace packages a package ships with, derived from the dependency graph (P02.03).
 *
 * The server image used to name its workspace packages by hand, and the hand list drifted: the
 * voice and worker roles import `@moin/telephony` and `@moin/integrations`, which the image did not
 * carry, so those roles died with `ERR_MODULE_NOT_FOUND` while the API role and every build check
 * passed. The Dockerfile now runs this against the manifests: starting at the root package, it
 * follows `dependencies` and `optionalDependencies` entries that point into the workspace
 * (`workspace:`), transitively, and never `devDependencies` (a test or build toolchain must not
 * reach a runtime image).
 *
 * It writes, under the output directory:
 * - `manifests/<dir>/package.json` for the root and every package it needs, to be copied into the
 *   production dependency stage so the lockfile installs exactly that set;
 * - `packages.txt`, one directory per line (the root excluded), for the stage that copies sources.
 *
 * A prod dependency that names a workspace package that does not exist fails the build.
 * Usage: node scripts/workspace-closure.ts <root package dir> <output dir>
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Manifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const WORKSPACE_PARENTS = ['apps', 'packages'] as const;

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

/** Package name to directory, for every workspace package (pnpm-workspace.yaml: apps/*, packages/*). */
function workspacePackages(): Map<string, string> {
  const byName = new Map<string, string>();
  for (const parent of WORKSPACE_PARENTS) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const dir = join(parent, entry.name);
      if (!entry.isDirectory() || !existsSync(join(dir, 'package.json'))) continue;
      const name = readManifest(dir).name;
      if (name !== undefined) byName.set(name, dir);
    }
  }
  return byName;
}

/** The directories of everything `root` needs at run time, root first. */
export function closureOf(root: string, packages: ReadonlyMap<string, string>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    order.push(dir);
    const manifest = readManifest(dir);
    const runtime = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const [name, spec] of Object.entries(runtime)) {
      if (!spec.startsWith('workspace:')) continue;
      const target = packages.get(name);
      if (target === undefined) {
        throw new Error(`${dir} depends on workspace package ${name}, which does not exist`);
      }
      visit(target);
    }
  };
  visit(root);
  return order;
}

function main(): void {
  const [root, out] = process.argv.slice(2);
  if (root === undefined || out === undefined) {
    throw new Error('usage: node scripts/workspace-closure.ts <root package dir> <output dir>');
  }
  const closure = closureOf(root, workspacePackages());
  for (const dir of closure) {
    const target = join(out, 'manifests', dir);
    mkdirSync(target, { recursive: true });
    cpSync(join(dir, 'package.json'), join(target, 'package.json'));
  }
  writeFileSync(join(out, 'packages.txt'), `${closure.slice(1).join('\n')}\n`);
  process.stdout.write(`${closure.slice(1).join('\n')}\n`);
}

if (process.argv[1]?.endsWith('workspace-closure.ts') === true) main();
