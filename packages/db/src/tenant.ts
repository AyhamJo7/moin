/**
 * `withTenant` and `withSystemWork` — the only sanctioned ways to reach tenant data
 * (P06.03.01, P06.14.01, INV-01, INV-02).
 *
 * ## What this is actually for
 *
 * The row-level-security policies added in P06.02 compare `organisation_id` against
 * `app.current_org()`, which reads a **transaction-local** setting. Something has to set it, on the
 * same connection, inside the same transaction, every time. This is that something, and it is the
 * only thing that is: `@moin/db/pool` is a separate entry point precisely so that a boundary rule
 * can see, and forbid, anyone reaching around it.
 *
 * ## Transaction-local, not session-level
 *
 * `set_config(…, true)` scopes the setting to the transaction. A session-level `SET` would survive
 * the transaction and ride the pooled connection into the *next* request — one caller's tenant
 * applied to another caller's query. That is the single worst bug this codebase could have, so the
 * lint rule bans session-level `SET` outright and this module is the only place the setting is
 * written at all.
 *
 * ## The tenant is validated before it is used
 *
 * A malformed organisation id would be rejected by PostgreSQL when the policy casts it, which is
 * safe but late and produces an error that reads like a database fault. It is checked here, so the
 * caller gets a clear failure at the boundary instead.
 *
 * ## Nesting a different tenant is a bug, not a feature
 *
 * Nesting the *same* tenant is ordinary — a service calls another service. Nesting a **different**
 * one means code is about to act for organisation B inside a transaction opened for organisation A,
 * and whichever wins, something is wrong. It throws.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool, PoolClient } from 'pg';

/** RFC 4122 shape. Deliberately not a full version check: the database defines the domain. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The setting the RLS policies read. One name, one place. */
export const TENANT_SETTING = 'app.organisation_id';

export class TenantContextError extends Error {
  public override readonly name = 'TenantContextError';
}

/**
 * What a unit of work knows about who it is for.
 *
 * `organisationId` identifies a *business*, not a person, which is why it is safe to log and why
 * the redaction allowlist permits it. `actorId` and `correlationId` are opaque identifiers for
 * the same reason.
 */
export interface TenantContext {
  readonly organisationId: string;
  readonly actorId?: string | undefined;
  readonly correlationId?: string | undefined;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** The tenant of the current unit of work, or undefined outside one. */
export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Fields a log line or span may carry about the current unit of work.
 *
 * Returns an empty object outside a tenant transaction rather than throwing: a logger that fails
 * because there is no tenant would take down exactly the paths that have none.
 */
export function tenantLogFields(): Record<string, string> {
  const context = storage.getStore();
  if (context === undefined) {
    return {};
  }
  return {
    organisationId: context.organisationId,
    ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
    ...(context.correlationId === undefined ? {} : { correlationId: context.correlationId }),
  };
}

/** The handle a unit of work gets. Deliberately narrower than `PoolClient`. */
export interface TenantClient {
  /**
   * `R` appears only in the return type, which makes it an assertion rather than an inference —
   * the lint rule that flags this is correct about the mechanics. It is kept because the shape of
   * a result set is decided by the database, not by TypeScript, and the alternatives are worse:
   * returning `unknown[]` moves the same cast to every call site, and returning a wide record type
   * removes it entirely. Naming the shape at the call site at least puts the claim where a
   * reviewer can compare it with the SQL directly above it.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above: the row shape is asserted, and the assertion belongs at the call site next to its SQL.
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

function assertOrganisationId(value: string): void {
  if (!UUID.test(value)) {
    // The value is not echoed: an organisation id is not a secret, but a malformed one is usually
    // attacker-supplied, and quoting attacker input into an error message is a habit worth not
    // having (INV-12).
    throw new TenantContextError(
      'organisation id is not a UUID. It is resolved server-side from the session, the route or ' +
        'the job envelope, never from a request body, query string or header (INV-02).',
    );
  }
}

export interface WithTenantOptions {
  readonly actorId?: string | undefined;
  readonly correlationId?: string | undefined;
}

/**
 * Runs `fn` in a transaction scoped to one organisation.
 *
 * Commits on return, rolls back on throw. The client is released either way, including when the
 * rollback itself fails — a leaked client is a connection the pool never gets back, and a pool
 * that runs out looks like a database outage.
 */
export async function withTenant<T>(
  pool: Pool,
  organisationId: string,
  fn: (client: TenantClient) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  assertOrganisationId(organisationId);

  const outer = storage.getStore();
  if (outer !== undefined && outer.organisationId !== organisationId) {
    throw new TenantContextError(
      `already inside a transaction for a different organisation. Nesting one tenant's work ` +
        'inside another’s means one of the two is wrong, whichever the database ends up applying.',
    );
  }

  const context: TenantContext = {
    organisationId,
    actorId: options.actorId ?? outer?.actorId,
    correlationId: options.correlationId ?? outer?.correlationId,
  };

  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin');
    // Transaction-local. The `true` is the whole argument of this module.
    await client.query('select set_config($1, $2, true)', [TENANT_SETTING, organisationId]);
    const result = await storage.run(context, async () => fn(wrap(client)));
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // A rollback that fails means the connection is already broken; the release below discards
      // it. Rethrowing from here would replace the caller's real error with a worse one.
    }
    throw error;
  } finally {
    client.release();
  }
}

function wrap(client: PoolClient): TenantClient {
  return {
    async query(sql, params) {
      const result = await client.query(sql, params === undefined ? undefined : [...params]);
      return { rows: result.rows as never, rowCount: result.rowCount };
    },
  };
}

/** One claimed item of cross-tenant work. */
export interface ClaimedItem {
  readonly organisationId: string;
  readonly id: string;
}

export interface SystemWorkResult {
  readonly claimed: number;
  readonly processed: number;
  readonly failed: number;
}

/**
 * Cross-tenant work, one tenant transaction per item (P06.14.01).
 *
 * Sweeps, reconcilers, retention and metering run across tenants by definition, and the tempting
 * shortcut is a role that can see all of them at once. There is no such role: `claim` is a narrow
 * `SECURITY DEFINER` function that returns **identifiers only**, and each identifier is then
 * processed inside `withTenant`, under the policy, as the ordinary application role.
 *
 * One failing item does not abandon the rest: each runs in its own transaction, and the failure is
 * reported rather than thrown, because a sweep that stops at the first bad row leaves the rest of
 * the queue growing behind it.
 */
export async function withSystemWork(
  pool: Pool,
  claim: (client: TenantClient) => Promise<readonly ClaimedItem[]>,
  process: (item: ClaimedItem, client: TenantClient) => Promise<void>,
  onFailure?: (item: ClaimedItem, error: unknown) => void,
): Promise<SystemWorkResult> {
  const claimClient: PoolClient = await pool.connect();
  let items: readonly ClaimedItem[];
  try {
    // The claim runs in its own transaction, so its leases are committed before any item is
    // processed. Holding them open across the work would turn a slow item into a lock timeout.
    await claimClient.query('begin');
    items = await claim(wrap(claimClient));
    await claimClient.query('commit');
  } catch (error) {
    try {
      await claimClient.query('rollback');
    } catch {
      // See withTenant.
    }
    throw error;
  } finally {
    claimClient.release();
  }

  for (const item of items) {
    assertOrganisationId(item.organisationId);
  }

  let processed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await withTenant(pool, item.organisationId, async (client) => process(item, client));
      processed += 1;
    } catch (error) {
      failed += 1;
      onFailure?.(item, error);
    }
  }
  return { claimed: items.length, processed, failed };
}
