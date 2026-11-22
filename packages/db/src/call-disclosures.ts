/**
 * The disclosure a call was issued (ROADMAP S1, P11.02.04, INV-03). Table in migration 0085.
 * Every function runs inside `withTenant`.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const VERSION_SHAPE = /^[a-z0-9][a-z0-9.-]{0,63}$/u;

export interface IssuedDisclosure {
  readonly version: string;
  readonly businessName: string;
}

/**
 * Records the disclosure inputs `callId` was issued. First issue wins: a retried webhook leaves
 * them as they were and gets them back, so it can speak exactly the words first issued.
 */
export async function recordCallDisclosure(
  client: TenantClient,
  callId: string,
  issue: IssuedDisclosure,
): Promise<IssuedDisclosure> {
  if (!VERSION_SHAPE.test(issue.version)) {
    throw new RangeError('disclosure version has the wrong shape');
  }
  await client.query(
    `insert into call_disclosures (organisation_id, id, call_id, disclosure_version, business_name)
     values (app.current_org(), $1, $2, $3, $4)
     on conflict (organisation_id, call_id) do nothing`,
    [randomUUID(), callId, issue.version, issue.businessName],
  );
  const stored = await client.query<{ disclosure_version: string; business_name: string }>(
    'select disclosure_version, business_name from call_disclosures where call_id = $1',
    [callId],
  );
  const row = stored.rows[0];
  if (row === undefined) throw new Error('call disclosure row is missing after insert');
  return { version: row.disclosure_version, businessName: row.business_name };
}

/**
 * The name the disclosure speaks for this tenant: its business-profile name, or the
 * organisation's registered name when no profile name is set.
 */
export async function spokenBusinessName(client: TenantClient): Promise<string> {
  const result = await client.query<{ name: string | null }>(
    `select coalesce(
       (select btrim(p.name) from business_profile p where p.category = 'business_name'),
       (select btrim(o.name) from organisations o where o.id = app.current_org())
     ) as name`,
  );
  const name = result.rows[0]?.name ?? null;
  if (name === null || name === '') throw new Error('the tenant has no name to speak');
  return name;
}
