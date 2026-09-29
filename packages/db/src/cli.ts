/**
 * `pnpm db:migrate` and `pnpm db:seed`.
 *
 * Reads the migration connection string, not the application one: migrations run as the role that
 * is allowed to issue DDL, and the application role deliberately is not (ADR-0003, INV-01).
 */

import { migrate } from './migrate.ts';
import { seed } from './seed.ts';

function connectionString(): string {
  const value = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];
  if (value === undefined || value.length === 0) {
    console.error(
      'DATABASE_MIGRATION_URL is not set (DATABASE_URL is used as a fallback). ' +
        'Copy .env.example to .env — every value in it is a development-only fake.',
    );
    process.exit(1);
  }
  return value;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  try {
    if (command === 'migrate') {
      const outcome = await migrate(connectionString());
      console.log(
        outcome.applied.length === 0
          ? `nothing to apply (${String(outcome.alreadyApplied)} migration(s) already applied)`
          : `applied ${String(outcome.applied.length)}: ${outcome.applied.join(', ')}`,
      );
      return 0;
    }
    if (command === 'seed') {
      const outcome = await seed(connectionString());
      console.log(`seeded ${String(outcome.applied)} row(s)`);
      for (const note of outcome.skipped) console.log(`  skipped — ${note}`);
      return 0;
    }
    console.error('usage: db migrate | db seed');
    return 2;
  } catch (error) {
    // The connection string can carry a password, so the driver's message is not echoed (INV-15).
    console.error(error instanceof Error ? error.message : 'the command failed');
    return 1;
  }
}

process.exitCode = await main();
