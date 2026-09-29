import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrations } from './migrate.ts';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function withFiles(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'moin-migrations-'));
  created.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql, 'utf8');
  return dir;
}

describe('migration loading', () => {
  it('orders migrations by their numeric prefix, not by discovery order', () => {
    const dir = withFiles({
      '0010_later.sql': 'select 10;',
      '0002_second.sql': 'select 2;',
      '0001_first.sql': 'select 1;',
    });
    expect(loadMigrations(dir).map((m) => m.version)).toStrictEqual(['0001', '0002', '0010']);
  });

  // Ordering is the whole contract. A file that does not encode its position cannot be placed.
  it('rejects a filename that does not encode an order', () => {
    expect(() => loadMigrations(withFiles({ 'add_contacts.sql': 'select 1;' }))).toThrow(
      /must be named/,
    );
  });

  it('rejects two migrations sharing a version, which would make order undefined', () => {
    const dir = withFiles({ '0001_one.sql': 'select 1;', '0001_two.sql': 'select 2;' });
    expect(() => loadMigrations(dir)).toThrow(/share version/);
  });

  it('ignores files that are not SQL', () => {
    const dir = withFiles({ '0001_first.sql': 'select 1;', 'README.md': '# notes' });
    expect(loadMigrations(dir)).toHaveLength(1);
  });

  // The checksum is what turns "someone edited an applied migration" from a silent divergence
  // between production and a fresh database into a startup failure.
  it('derives a checksum from the file contents', () => {
    const a = loadMigrations(withFiles({ '0001_first.sql': 'select 1;' }))[0];
    const b = loadMigrations(withFiles({ '0001_first.sql': 'select 1;' }))[0];
    const c = loadMigrations(withFiles({ '0001_first.sql': 'select 2;' }))[0];
    expect(a?.checksum).toBe(b?.checksum);
    expect(a?.checksum).not.toBe(c?.checksum);
  });

  it('loads the repository’s own migrations', () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.name).toBe('schema_migrations');
  });
});
