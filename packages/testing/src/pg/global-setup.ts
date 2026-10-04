/**
 * Build the template database once per integration run (P02.05.02).
 *
 * Migrations run once here rather than per test file. Applying them per file would multiply a
 * growing migration history by the number of files and turn the integration suite into the slowest
 * thing in CI — the exact pressure that leads to tests being deleted.
 */

import { createPool } from '@moin/db/pool';
import { migrate } from '@moin/db/migrate';
import { TEMPLATE_DATABASE } from './template.ts';

function adminUrl(): string {
  const url = process.env['TEST_DATABASE_ADMIN_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL is not set. It is in the example environment file, which ' +
        '`pnpm test:integration` reads — so this usually means that file has not been copied ' +
        'yet. The local stack must also be running (`pnpm dev:up`).',
    );
  }
  return url;
}

export async function setup(): Promise<void> {
  const admin = adminUrl();
  const pool = createPool({ connectionString: admin, max: 1 });
  try {
    // Rebuilt from scratch every run: a template carried over from a previous run would embed
    // whatever schema that run had, which is how "works on my machine" starts.
    await pool.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [TEMPLATE_DATABASE],
    );
    // eslint-disable-next-line no-restricted-syntax -- database identifier. TEMPLATE_DATABASE is a module constant.
    await pool.query(`drop database if exists "${TEMPLATE_DATABASE}" with (force)`);
    // eslint-disable-next-line no-restricted-syntax -- database identifier. TEMPLATE_DATABASE is a module constant.
    await pool.query(`create database "${TEMPLATE_DATABASE}"`);
  } finally {
    await pool.end();
  }

  const templateUrl = new URL(admin);
  templateUrl.pathname = `/${TEMPLATE_DATABASE}`;

  // Extensions come before migrations and are created here rather than by a migration, because
  // `CREATE EXTENSION` needs privileges the migration role deliberately does not have — the same
  // split as production, where the local init scripts and Terraform create them against RDS.
  // Without this the template is a bare database and every test built on it lacks pgvector.
  const template = createPool({ connectionString: templateUrl.toString(), max: 1 });
  try {
    for (const extension of ['vector', 'pgcrypto', 'citext', 'pg_trgm']) {
      // eslint-disable-next-line no-restricted-syntax -- database identifier. The extension names come from a literal array in this file.
      await template.query(`create extension if not exists ${extension}`);
    }
    // The template database is created by the local owner. Migrations must run as the
    // NOBYPASSRLS migrator so SECURITY DEFINER tests exercise FORCE RLS in earnest.
    await template.query('alter schema public owner to moin_migrator');
    // As the cluster init does (ADR-0003): nothing may create large objects through PUBLIC's
    // default EXECUTE. Function ACLs live in the database, so every clone inherits this.
    await template.query(
      'revoke execute on function lo_create(oid), lo_creat(integer), lo_from_bytea(oid, bytea) from public',
    );
    // eslint-disable-next-line no-restricted-syntax -- TEMPLATE_DATABASE is a module constant, never user input.
    await template.query(`grant create on database "${TEMPLATE_DATABASE}" to moin_migrator`);
    // Only the migrator works in the template. Database ACLs are not copied to a clone, so each
    // clone starts from PostgreSQL's defaults and `createTestDatabase` narrows TEMPORARY there.
    /* eslint-disable no-restricted-syntax -- TEMPLATE_DATABASE is a module constant, never user input. */
    await template.query(
      `revoke connect, temporary on database "${TEMPLATE_DATABASE}" from public`,
    );
    await template.query(`grant connect on database "${TEMPLATE_DATABASE}" to moin_migrator`);
    /* eslint-enable no-restricted-syntax */
  } finally {
    await template.end();
  }

  const migratorBase = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (migratorBase === undefined || migratorBase.length === 0) {
    throw new Error('TEST_DATABASE_MIGRATOR_URL is required for non-bypass migration tests');
  }
  const migratorUrl = new URL(migratorBase);
  migratorUrl.pathname = `/${TEMPLATE_DATABASE}`;
  await migrate(migratorUrl.toString());

  // Marking it a template lets a role with CREATEDB clone it. It does not make it read-only; the
  // CONNECT restriction above is what keeps other roles out of it.
  const mark = createPool({ connectionString: admin, max: 1 });
  try {
    await mark.query(`update pg_database set datistemplate = true where datname = $1`, [
      TEMPLATE_DATABASE,
    ]);
  } finally {
    await mark.end();
  }
}

export async function teardown(): Promise<void> {
  const pool = createPool({ connectionString: adminUrl(), max: 1 });
  try {
    await pool.query(`update pg_database set datistemplate = false where datname = $1`, [
      TEMPLATE_DATABASE,
    ]);
    // eslint-disable-next-line no-restricted-syntax -- database identifier. TEMPLATE_DATABASE is a module constant.
    await pool.query(`drop database if exists "${TEMPLATE_DATABASE}" with (force)`);
  } finally {
    await pool.end();
  }
}
