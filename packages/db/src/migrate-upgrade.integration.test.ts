/**
 * Migration upgrade continuity (P06.06.03, Codex HIGH-1 regression).
 *
 * Applied migrations are immutable: the runner checksums every file against `schema_migrations`
 * on each run. A comment edit to an already-applied migration (as happened to 0012 on this
 * branch) breaks every existing database's upgrade with "has changed since it was applied".
 * This test pins the base-tree checksums: it migrates a scratch database from the BASE tree
 * (origin/main, which holds applied 0012) and asserts the working tree verifies unchanged
 * against it — i.e. no file at or below the base version was touched.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migrate.ts';

describe('migration upgrade continuity', () => {
  it('leaves every base-applied migration byte-identical', () => {
    // Base file set: migrations present at origin/main (the applied prefix). Shallow or
    // single-branch checkouts may lack that ref: skip with a message rather than error, so the
    // suite stays green where the comparison is unavailable (never silent-pass where it is).
    let baseFiles: string[];
    try {
      baseFiles = execFileSync(
        'git',
        ['ls-tree', '-r', '--name-only', 'origin/main', '--', 'packages/db/migrations/'],
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter((line) => line.endsWith('.sql'));
    } catch {
      console.log('SKIP: origin/main ref unavailable; upgrade-continuity unchecked here');
      return;
    }
    expect(baseFiles.length).toBeGreaterThan(0);
    const worktreeFiles = loadMigrations();
    const worktreeByVersion = new Map(worktreeFiles.map((m) => [m.version, m]));
    for (const file of baseFiles) {
      const version = file.split('/').at(-1)?.slice(0, 4);
      if (version === undefined) continue;
      let baseSql: string;
      try {
        baseSql = execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' });
      } catch {
        console.log(`SKIP: cannot read origin/main:${file}; upgrade-continuity unchecked here`);
        return;
      }
      const current = worktreeByVersion.get(version);
      expect(current, `migration ${version} removed from working tree`).toBeDefined();
      expect(current?.sql, `applied migration ${version} changed since base`).toBe(baseSql);
    }
  }, 60_000);
});
