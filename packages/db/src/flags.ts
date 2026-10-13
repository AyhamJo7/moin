/**
 * Feature flags + kill switches (P08.10, ADR-0032): typed accessors over the
 * global catalogue with per-tenant overrides.
 *
 * Read path: tenant override wins, else the global default (P08.10.01).
 * Reads cache ≤ 60 s at the caller (P08.10.01) — the TTL is the caller's, so
 * a kill propagates within a minute without a deploy. Writes (`setFlag`)
 * are operator actions: audited with the flag name + value markers only
 * (P08.10.03, INV-12 — no reason text in the trail).
 *
 * The `ai_answering` kill (P08.10.04) is the load-bearing one: off means the
 * next call uses deterministic capture only — the voice runtime branches on
 * `isAiAnsweringEnabled` before any model call.
 */

import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

/** Global kill switches (P08.10.02): closed catalogue, never free text. */
export const KILL_SWITCHES = [
  'ai_answering',
  'faq_answering',
  'llm_wording',
  'transfers',
  'sms',
  'booking_execution',
] as const;

export type KillSwitch = (typeof KILL_SWITCHES)[number];

/** Propagation bound: cached reads refresh within 60 s (P08.10.01). */
export const FLAG_CACHE_TTL_S = 60;

function checkFlag(flag: string): KillSwitch {
  if (!(KILL_SWITCHES as readonly string[]).includes(flag)) {
    throw new RangeError(`unknown flag: ${flag}`);
  }
  return flag as KillSwitch;
}

/** Effective value: tenant override wins, else the global default. */
export async function isEnabled(client: TenantClient, flag: string): Promise<boolean> {
  const name = checkFlag(flag);
  const found = await client.query<{ enabled: boolean }>(
    `select coalesce(
       (select enabled from tenant_flag_overrides
        where organisation_id = app.current_org() and flag_name = $1::text),
       (select default_on from feature_flag_definitions where name = $1::text),
       true
     ) as enabled`,
    [name],
  );
  return found.rows[0]?.enabled ?? true;
}

/** Typed accessor for the load-bearing kill (P08.10.04). */
export async function isAiAnsweringEnabled(client: TenantClient): Promise<boolean> {
  return isEnabled(client, 'ai_answering');
}

/**
 * Flip a flag for this tenant (P08.10.03): upsert override + audit.
 * Clearing (enabled=null) removes the override — the default applies again.
 */
export async function setFlag(
  client: TenantClient,
  flag: string,
  enabled: boolean | null,
): Promise<boolean> {
  const name = checkFlag(flag);
  if (enabled === null) {
    const done = await client.query<{ name: string }>(
      `delete from tenant_flag_overrides
       where organisation_id = app.current_org() and flag_name = $1::text
       returning flag_name as name`,
      [name],
    );
    const cleared = done.rows[0] !== undefined;
    if (cleared) {
      await appendAuditEvent(client, {
        source: 'operator',
        operation: 'flag.clear',
        targetKind: 'feature_flag',
        argsSanitized: { flag_cleared: 1 },
        result: 'succeeded',
      });
    }
    return cleared;
  }
  await client.query(
    `insert into tenant_flag_overrides (organisation_id, id, flag_name, enabled)
     values (app.current_org(), gen_random_uuid(), $1::text, $2::boolean)
     on conflict (organisation_id, flag_name) do update set enabled = excluded.enabled,
       updated_at = now()`,
    [name, enabled],
  );
  await appendAuditEvent(client, {
    source: 'operator',
    operation: 'flag.set',
    targetKind: 'feature_flag',
    argsSanitized: { flag_set: 1, flag_on: enabled ? 1 : 0 },
    result: 'succeeded',
  });
  return true;
}
