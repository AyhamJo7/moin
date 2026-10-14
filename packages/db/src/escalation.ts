/**
 * Escalation chains and acknowledgements (P14.05.01–.04, migration 0072).
 *
 * `chainStep` is the pure transition: no ack → next unexpired level fires;
 * ack/done/exhausted stops the chain. `recordAck` writes the stop row
 * (idempotent per ref — first state wins). Exactly-once per step (P14.05.04)
 * is the (ref, level) unique key: repeats keep the row.
 */

import { randomUUID } from 'node:crypto';
import type { TenantClient } from './tenant.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type EscalationStop = 'acknowledged' | 'done' | 'exhausted';

export interface EscalationLevel {
  readonly level: number;
  readonly contactUserId: string;
  readonly dueAtMs: number;
}

export interface ChainStep {
  readonly stopped: boolean;
  readonly fireLevel: EscalationLevel | null;
}

/**
 * Pure step: stopped when acked; otherwise the first level whose deadline
 * has passed fires; null while waiting on the current deadline.
 */
export function chainStep(
  levels: readonly EscalationLevel[],
  stop: EscalationStop | null,
  nowMs: number,
): ChainStep {
  if (stop !== null) return { stopped: true, fireLevel: null };
  const ordered = [...levels].sort((a, b) => a.level - b.level);
  for (const level of ordered) {
    if (nowMs >= level.dueAtMs) return { stopped: false, fireLevel: level };
  }
  return { stopped: false, fireLevel: null };
}

/** Schedule one escalation level: idempotent per (ref, level). */
export async function scheduleLevel(
  client: TenantClient,
  input: { refKind: string; refId: string; level: number; contactUserId: string; dueAt: Date },
): Promise<string> {
  const refKind = input.refKind.trim();
  if (refKind.length === 0 || refKind.length > 80) {
    throw new RangeError('ref kind must be 1..80 characters');
  }
  if (!UUID_RE.test(input.refId)) throw new RangeError('ref id must be a uuid');
  if (!UUID_RE.test(input.contactUserId)) throw new RangeError('contact user id must be a uuid');
  if (!Number.isInteger(input.level) || input.level < 0) {
    throw new RangeError('level must be an integer ≥ 0');
  }
  if (!Number.isFinite(input.dueAt.getTime())) throw new RangeError('due_at must be a date');
  const done = await client.query<{ id: string }>(
    `insert into escalation_chains (organisation_id, id, ref_kind, ref_id, level, contact_user_id, due_at)
     values (app.current_org(), $1::uuid, $2::text, $3::uuid, $4::integer, $5::uuid, $6::timestamptz)
     on conflict (organisation_id, ref_id, level) do update set due_at = least(escalation_chains.due_at, excluded.due_at)
     returning id::text`,
    [
      randomUUID(),
      refKind,
      input.refId,
      input.level,
      input.contactUserId,
      input.dueAt.toISOString(),
    ],
  );
  const row = done.rows[0];
  if (row === undefined) throw new Error('escalation schedule returned no row');
  return row.id;
}

/** Record the stop state: idempotent per ref — first state wins. */
export async function recordAck(
  client: TenantClient,
  input: { refKind: string; refId: string; state: EscalationStop },
): Promise<string> {
  const refKind = input.refKind.trim();
  if (refKind.length === 0 || refKind.length > 80) {
    throw new RangeError('ref kind must be 1..80 characters');
  }
  if (!UUID_RE.test(input.refId)) throw new RangeError('ref id must be a uuid');
  const done = await client.query<{ id: string }>(
    `insert into escalation_acks (organisation_id, id, ref_kind, ref_id, state)
     values (app.current_org(), $1::uuid, $2::text, $3::uuid, $4::text)
     on conflict (organisation_id, ref_id) do nothing
     returning id::text`,
    [randomUUID(), refKind, input.refId, input.state],
  );
  const row = done.rows[0];
  if (row === undefined) {
    const existing = await client.query<{ id: string }>(
      `select id::text from escalation_acks
       where organisation_id = app.current_org() and ref_id = $1::uuid`,
      [input.refId],
    );
    const found = existing.rows[0];
    if (found === undefined) throw new Error('escalation ack returned no row');
    return found.id;
  }
  return row.id;
}
