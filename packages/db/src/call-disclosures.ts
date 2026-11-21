/**
 * The disclosure a call was issued, and evidence that it was played (ROADMAP S1, P11.02.04,
 * INV-03). Tables in migration 0085. Every function runs inside `withTenant`.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

export type DisclosurePlayback = 'confirmed' | 'interrupted';

const VERSION_SHAPE = /^[a-z0-9][a-z0-9.-]{0,63}$/u;

/**
 * Records which disclosure version `callId` was issued. First issue wins: a retried webhook
 * leaves the stored version as it was. Returns the stored version.
 */
export async function recordCallDisclosure(
  client: TenantClient,
  callId: string,
  version: string,
): Promise<string> {
  if (!VERSION_SHAPE.test(version)) throw new RangeError('disclosure version has the wrong shape');
  await client.query(
    `insert into call_disclosures (organisation_id, id, call_id, disclosure_version)
     values (app.current_org(), $1, $2, $3)
     on conflict (organisation_id, call_id) do nothing`,
    [randomUUID(), callId, version],
  );
  const stored = await client.query<{ disclosure_version: string }>(
    'select disclosure_version from call_disclosures where call_id = $1',
    [callId],
  );
  const row = stored.rows[0];
  if (row === undefined) throw new Error('call disclosure row is missing after insert');
  return row.disclosure_version;
}

/**
 * Records playback evidence for the call with this provider SID. The first verdict stands, so a
 * close after a confirmation never downgrades it. Returns false when no disclosure was issued
 * for that SID in this tenant (nothing to attach the evidence to).
 */
export async function recordDisclosurePlayback(
  client: TenantClient,
  providerCallSid: string,
  outcome: DisclosurePlayback,
): Promise<boolean> {
  const issued = await client.query<{ call_id: string }>(
    `select d.call_id from call_disclosures d join calls c on c.id = d.call_id
     where c.provider_call_sid = $1`,
    [providerCallSid],
  );
  const callId = issued.rows[0]?.call_id;
  if (callId === undefined) return false;
  await client.query(
    `insert into call_disclosure_playbacks (organisation_id, id, call_id, outcome)
     values (app.current_org(), $1, $2, $3)
     on conflict (organisation_id, call_id) do nothing`,
    [randomUUID(), callId, outcome],
  );
  return true;
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
