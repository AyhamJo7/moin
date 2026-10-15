/**
 * Pre-tenancy route resolution (P11.02).
 *
 * The voice adapter resolves the dialled number before any session exists,
 * so `withTenant` cannot apply (there is no organisation yet — resolution
 * *produces* it). This module is the one platform-owned place allowed to
 * hold the route pool: it never opens a tenant transaction, it calls the
 * DEFINER-only `app.resolve_route` and returns two uuids, nothing else.
 * The boundary rule permits `modules/platform` to touch pool handles; the
 * voice module goes through here.
 */

import { createPool, type Pool } from '@moin/db/pool';

export interface RouteHit {
  readonly organisationId: string;
  readonly locationId: string;
}

export interface RouteResolver {
  readonly resolve: (e164: string) => Promise<readonly RouteHit[]>;
  readonly end: () => Promise<void>;
}

export function createRouteResolver(connectionString: string, appName: string): RouteResolver {
  const pool: Pool = createPool({
    connectionString,
    max: 2,
    application_name: appName,
  });
  return {
    async resolve(e164: string): Promise<readonly RouteHit[]> {
      const rows = await pool.query<{ organisation_id: string; location_id: string }>(
        'select * from app.resolve_route($1::text)',
        [e164],
      );
      return rows.rows.map((row) => ({
        organisationId: row.organisation_id,
        locationId: row.location_id,
      }));
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}
