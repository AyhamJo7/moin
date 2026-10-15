/**
 * Notification model and preferences (P14.01.01/.03, migration 0071).
 *
 * `triggerNotification` is idempotent per dedup_key — repeats keep the row,
 * never double-notify. `resolveChannels` honours prefs: urgent-only users
 * get urgent alone; quiet hours silence routine but urgent bypasses them
 * only for configured `urgent_bypass` contacts. Content is ID refs (INV-12).
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type NotificationPriority = 'routine' | 'urgent';

export interface NotificationPrefs {
  readonly channels: readonly string[];
  readonly urgentOnly: boolean;
  readonly quietFrom: string | null;
  readonly quietTo: string | null;
  readonly urgentBypass: boolean;
}

function checkDedup(dedupKey: string): string {
  const trimmed = dedupKey.trim();
  if (trimmed.length === 0 || trimmed.length > 160) {
    throw new RangeError('dedup key must be 1..160 characters');
  }
  return trimmed;
}

/**
 * Trigger one notification: idempotent per dedup_key — repeats return the
 * existing row id. Returns the notification id either way.
 */
export async function triggerNotification(
  client: TenantClient,
  input: { dedupKey: string; priority: NotificationPriority; refKind: string; refId: string },
): Promise<string> {
  const dedupKey = checkDedup(input.dedupKey);
  const refKind = input.refKind.trim();
  if (refKind.length === 0 || refKind.length > 80) {
    throw new RangeError('ref kind must be 1..80 characters');
  }
  if (!UUID_RE.test(input.refId)) throw new RangeError('ref id must be a uuid');
  const done = await client.query<{ id: string }>(
    `insert into notifications (organisation_id, id, dedup_key, priority, ref_kind, ref_id)
     values (app.current_org(), $1::uuid, $2::text, $3::text, $4::text, $5::uuid)
     on conflict (organisation_id, dedup_key) do update set dedup_key = excluded.dedup_key
     returning id::text`,
    [randomUUID(), dedupKey, input.priority, refKind, input.refId],
  );
  const row = done.rows[0];
  if (row === undefined) throw new Error('notification trigger returned no row');
  return row.id;
}

/** True when now falls inside the quiet window (overnight wraps). */
export function inQuietHours(prefs: NotificationPrefs, now: string): boolean {
  if (prefs.quietFrom === null || prefs.quietTo === null) return false;
  if (prefs.quietFrom <= prefs.quietTo) return now >= prefs.quietFrom && now < prefs.quietTo;
  return now >= prefs.quietFrom || now < prefs.quietTo;
}

/**
 * Resolve delivery channels: urgent-only prefs drop routine; quiet hours
 * silence routine; urgent bypasses quiet hours only for configured contacts.
 */
export function resolveChannels(
  prefs: NotificationPrefs,
  priority: NotificationPriority,
  now: string,
): readonly string[] {
  if (priority === 'routine' && prefs.urgentOnly) return [];
  if (inQuietHours(prefs, now)) {
    if (priority === 'urgent' && prefs.urgentBypass) return prefs.channels;
    return [];
  }
  if (priority === 'urgent') return prefs.channels;
  return prefs.channels.filter((c) => c === 'inapp' || c === 'email');
}
