/**
 * The harness testing itself (P02.05.02, P02.05.06).
 *
 * If the harness is wrong, every test built on it is wrong in the same direction and nothing says
 * so. These assertions are the ones that would go quiet first: that each file really does get its
 * own database, that the application role really is the restricted one, and that a database is
 * really destroyed afterwards rather than accumulating.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './template.ts';

describe('real-postgres harness', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('harness');
  }, 60_000);

  afterAll(async () => {
    await database.drop();
  });

  it('clones a database that already has the migrations applied', async () => {
    const result = await database
      .pool()
      .query<{ version: string }>('select version from schema_migrations order by version');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]?.version).toBe('0001');
  });

  it('connects as the application role, which is not a superuser', async () => {
    const result = await database
      .pool()
      .query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
      );
    const role = result.rows[0];
    expect(
      role?.rolsuper,
      'a superuser silently bypasses RLS, so isolation tests would be meaningless',
    ).toBe(false);
    expect(role?.rolbypassrls, 'BYPASSRLS would do the same (INV-01)').toBe(false);
  });

  it('gives each caller a separate database', async () => {
    const other = await createTestDatabase('harness-other');
    try {
      expect(other.name).not.toBe(database.name);

      // A table created in one must not be visible in the other.
      await database.pool().query('create temporary table isolation_probe (id int)');
      const seenElsewhere = await other
        .pool()
        .query<{ count: string }>(
          "select count(*)::text as count from pg_tables where tablename = 'isolation_probe'",
        );
      expect(seenElsewhere.rows[0]?.count).toBe('0');
    } finally {
      await other.drop();
    }
  });

  it('drops the database afterwards rather than leaving it behind', async () => {
    const temporary = await createTestDatabase('harness-drop');
    const name = temporary.name;
    await temporary.pool().query('select 1');
    await temporary.drop();

    const result = await database
      .pool()
      .query<{ count: string }>(
        'select count(*)::text as count from pg_database where datname = $1',
        [name],
      );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('has the extensions the application depends on', async () => {
    const result = await database
      .pool()
      .query<{ extname: string }>('select extname from pg_extension order by extname');
    const names = result.rows.map((row) => row.extname);
    expect(names).toContain('vector');
    expect(names).toContain('pgcrypto');
    expect(names).toContain('citext');
  });
});
