/**
 * Pre-tenancy route resolution (P11.02).
 *
 * The voice adapter resolves the dialled number before any session exists,
 * so `withTenant` cannot apply (there is no organisation yet — resolution
 * *produces* it). This module is the one platform-owned place allowed to
 * hold the route pool: it never opens a tenant transaction, it calls the
 * DEFINER-only `app.resolve_route` and returns two uuids, nothing else, and
 * `app.bind_call_route`, which returns one.
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
  /**
   * Binds a CallSid to the organisation its first webhook was routed to and returns the bound
   * organisation: a retry after the number was reassigned gets the original one back (S1).
   */
  readonly bindCall: (callSid: string, organisationId: string) => Promise<string>;
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
    async bindCall(callSid: string, organisationId: string): Promise<string> {
      const rows = await pool.query<{ organisation_id: string | null }>(
        'select app.bind_call_route($1::text, $2::uuid) as organisation_id',
        [callSid, organisationId],
      );
      const bound = rows.rows[0]?.organisation_id ?? null;
      if (bound === null) throw new Error('call binding returned no organisation');
      return bound;
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}
