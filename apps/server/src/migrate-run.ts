/**
 * The body of the `migrate` role: apply the reviewed SQL migrations and report the outcome as an
 * exit code, which is what a release gates on (INV-17).
 *
 * The runner is injected so the contract can be tested without a database. The contract itself:
 * success is returned only after `migrate` resolved, and any failure, whatever it carried, becomes
 * exit 1 and one log line with the SQLSTATE or the error class, never the driver's message (it can
 * quote a connection string, INV-15) and never a "no migrations" line that reads as success.
 */

import type { Logger } from '@moin/observability';
import type { MigrationOutcome } from '@moin/db/migrate';

export type RunMigrations = (connectionString: string) => Promise<MigrationOutcome>;

export const EXIT_OK = 0;
export const EXIT_MIGRATION_FAILED = 1;

/** SQLSTATE if the driver supplied one, else the error class. Never a message. */
function reason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code)) return code;
  return error instanceof Error ? error.name : 'unknown';
}

export async function runMigrations(
  connectionString: string,
  migrate: RunMigrations,
  logger: Pick<Logger, 'info' | 'error'>,
): Promise<number> {
  try {
    const outcome = await migrate(connectionString);
    // `count` is on the log allowlist (INV-12); other field names would be redacted.
    logger.info({ outcome: 'applied', count: outcome.applied.length }, 'migration run complete');
    return EXIT_OK;
  } catch (error) {
    logger.error({ outcome: 'failed', reason: reason(error) }, 'migration run failed');
    return EXIT_MIGRATION_FAILED;
  }
}
