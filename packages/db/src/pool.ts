/**
 * Raw PostgreSQL handles.
 *
 * Deliberately a **separate entry point** (`@moin/db/pool`), not part of the package barrel.
 *
 * PLAN's hardest data rule is that only the `platform` module opens transactions and every query
 * goes through `withTenant` / `withSystemWork` (INV-01, INV-02). A boundary rule enforcing that
 * was written against `packages/db/src/client`, but real code imports `@moin/db`, which resolves
 * to the barrel — dependency-cruiser sees the edge `module → index.ts` and the edge
 * `index.ts → client.ts` belongs to the barrel, not to the module. The rule could not fire for
 * any import a developer would actually write, and its fixture only "proved" it by using a
 * six-level relative path nobody would type.
 *
 * Keeping raw handles behind their own specifier gives the rule an edge it can see: importing
 * `@moin/db/pool` is a distinct, greppable, lintable act.
 */

import { Pool, type PoolConfig } from 'pg';

export type { Pool, PoolConfig };

/**
 * A pool that reports connection failures instead of killing the process.
 *
 * An idle-client error — a server restart, a network drop — is emitted on the pool, and an
 * unhandled `error` event on an EventEmitter terminates the process. A database blip must not be
 * able to take the service down that way.
 */
export function createPool(config: PoolConfig): Pool {
  const pool = new Pool(config);
  pool.on('error', () => undefined);
  return pool;
}
