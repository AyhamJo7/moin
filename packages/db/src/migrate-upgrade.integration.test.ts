/**
 * Migration upgrade continuity (P06.06.03, Codex HIGH-1 regression).
 *
 * Applied migrations are immutable: the runner checksums every file against `schema_migrations`
 * on each run. A comment edit to an already-applied migration (as happened to 0012 on this
 * branch) breaks every existing database's upgrade with "has changed since it was applied".
 * This test pins the base-tree checksums against the merge-base with origin/main — the commit
 * this branch actually diverged from, i.e. the newest commit whose migrations are necessarily
 * already applied on any database tracking main. Fail-closed: when neither the ref nor a
 * merge-base is resolvable (shallow CI without history), the test throws rather than skips,
 * and the integration job fetches full history so the ref exists.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migrate.ts';

/** The newest commit shared with main: applied migrations stop here at the latest. */
function baseRef(): string {
  try {
    return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(
      'upgrade-continuity requires the merge-base with origin/main: fetch full history ' +
        '(actions/checkout with fetch-depth: 0) so applied migrations can be compared.',
    );
  }
}

describe('migration upgrade continuity', () => {
  it('leaves every base-applied migration byte-identical', () => {
    const base = baseRef();
    const baseFiles = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', base, '--', 'packages/db/migrations/'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.endsWith('.sql'));
    expect(baseFiles.length).toBeGreaterThan(0);
    const worktreeFiles = loadMigrations();
    const worktreeByVersion = new Map(worktreeFiles.map((m) => [m.version, m]));
    const skipped: string[] = [];
    for (const file of baseFiles) {
      const version = file.split('/').at(-1)?.slice(0, 4);
      if (version === undefined) continue;
      let baseSql: string;
      try {
        baseSql = execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
      } catch {
        skipped.push(file);
        continue;
      }
      const current = worktreeByVersion.get(version);
      expect(current, `migration ${version} removed from working tree`).toBeDefined();
      expect(current?.sql, `applied migration ${version} changed since base`).toBe(baseSql);
    }
    expect(skipped, `unreadable base files: ${skipped.join(', ')}`).toEqual([]);
  }, 60_000);
});
