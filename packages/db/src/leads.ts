/**
 * Leads (P07.07): qualified interest with the BR-008 machine and the needs-action invariant.
 *
 * Machine: new → needs_action → contacted → waiting → done, lost from any live rung,
 * lost_reason mandatory exactly when lost (DB CHECK). Entering needs_action ensures an open
 * task exists (idempotent by key `lead-<id>-needs-action`; concurrent entrants serialise on
 * the key's unique index and share the winner's row). The task link + history row write in the
 * same transaction as the status move — a lead in needs_action without an open task is
 * unrepresentable, not merely unlikely.
 *
 * All writes run inside `withTenant`; every mutation audits with opaque markers only (INV-12).
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { createTask } from './tasks.ts';
import type { TenantClient } from './tenant.ts';

export type LeadStatus = 'new' | 'needs_action' | 'contacted' | 'waiting' | 'done' | 'lost';
export type LostReason =
  'no_interest' | 'no_budget' | 'wrong_contact' | 'duplicate' | 'unreachable' | 'other';

/** Version or transition conflicts surface as 409 at the HTTP layer. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const STATUS_MARKER: Record<LeadStatus, number> = {
  new: 0,
  needs_action: 1,
  contacted: 2,
  waiting: 3,
  done: 4,
  lost: 5,
};

const TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ['needs_action', 'lost'],
  needs_action: ['contacted', 'lost'],
  contacted: ['waiting', 'lost'],
  waiting: ['done', 'lost'],
  done: [],
  lost: [],
};

export interface Lead {
  readonly id: string;
  readonly title: string;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly status: LeadStatus;
  readonly lostReason: LostReason | null;
  readonly taskId: string | null;
  readonly version: number;
}

interface LeadRow extends Record<string, unknown> {
  id: string;
  title: string;
  contact_id: string | null;
  conversation_id: string | null;
  status: string;
  lost_reason: string | null;
  task_id: string | null;
  version: string;
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    title: row.title,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    status: row.status as LeadStatus,
    lostReason: row.lost_reason as LostReason | null,
    taskId: row.task_id,
    version: Number(row.version),
  };
}

function checkTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    throw new RangeError('lead title must be 1..120 characters');
  }
  return trimmed;
}

export async function createLead(
  client: TenantClient,
  input: { title: string; contactId?: string | undefined; conversationId?: string | undefined },
): Promise<Lead> {
  const id = randomUUID();
  const result = await client.query<LeadRow>(
    `insert into leads (organisation_id, id, title, contact_id, conversation_id)
     values (app.current_org(), $1, $2, $3, $4)
     returning id, title, contact_id, conversation_id, status, lost_reason, task_id, version::text`,
    [id, checkTitle(input.title), input.contactId ?? null, input.conversationId ?? null],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('lead insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'lead.create',
    targetKind: 'lead',
    targetId: id,
    argsSanitized: { from_status: 0 },
    result: 'succeeded',
  });
  return toLead(row);
}

/** Ensure the needs_action task exists; concurrent callers share the winner's row. */
async function ensureNeedsActionTask(client: TenantClient, leadId: string): Promise<string> {
  const key = `lead-${leadId}-needs-action`;
  const existing = await client.query<{ task_id: string | null }>(
    `select task_id::text from leads where id = $1`,
    [leadId],
  );
  const linked = existing.rows[0]?.task_id;
  if (linked !== null && linked !== undefined) {
    const open = await client.query<{ n: string }>(
      `select count(*)::text as n from tasks
       where id = $1 and status in ('open', 'in_progress', 'waiting')`,
      [linked],
    );
    if (open.rows[0]?.n !== '0') return linked;
  }
  const task = await createTask(client, {
    title: 'Lead nachverfolgen',
    type: 'follow_up',
    idempotencyKey: key,
  });
  await client.query(`update leads set task_id = $2 where id = $1`, [leadId, task.id]);
  await client.query(
    `insert into lead_tasks (organisation_id, id, lead_id, task_id)
     values (app.current_org(), $1, $2, $3)
     on conflict (organisation_id, lead_id, task_id) do nothing`,
    [randomUUID(), leadId, task.id],
  );
  return task.id;
}

export async function setLeadStatus(
  client: TenantClient,
  leadId: string,
  next: LeadStatus,
  version: number,
  lostReason?: LostReason,
): Promise<Lead> {
  const current = await client.query<LeadRow>(
    `select id, title, contact_id, conversation_id, status, lost_reason, task_id, version::text from leads where id = $1`,
    [leadId],
  );
  const row = current.rows[0];
  if (row === undefined) throw new VersionConflictError(`lead ${leadId} not found`);
  const from = row.status as LeadStatus;
  if (!TRANSITIONS[from].includes(next)) {
    throw new VersionConflictError(`illegal lead transition ${from} → ${next}`);
  }
  if (next === 'lost' && lostReason === undefined) {
    throw new RangeError('lost leads need a reason');
  }
  if (next !== 'lost' && lostReason !== undefined) {
    throw new RangeError('only lost leads carry a reason');
  }
  const moved = await client.query<LeadRow>(
    `update leads set status = $2, lost_reason = $3, updated_at = clock_timestamp(),
       version = version + 1
     where id = $1 and version = $4
     returning id, title, contact_id, conversation_id, status, lost_reason, task_id, version::text`,
    [leadId, next, lostReason ?? null, version],
  );
  const nextRow = moved.rows[0];
  if (nextRow === undefined) throw new VersionConflictError(`lead ${leadId} version mismatch`);
  let taskId = nextRow.task_id;
  if (next === 'needs_action') {
    taskId = await ensureNeedsActionTask(client, leadId);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'lead.status',
    targetKind: 'lead',
    targetId: leadId,
    argsSanitized: { to_status: STATUS_MARKER[next] },
    result: 'succeeded',
  });
  if (next === 'needs_action') {
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'lead.task_link',
      targetKind: 'lead',
      targetId: leadId,
      argsSanitized: { linked: 1 },
      result: 'succeeded',
    });
  }
  return { ...toLead(nextRow), taskId };
}

export async function listLeads(
  client: TenantClient,
  input: { status?: LeadStatus | undefined; limit?: number | undefined } = {},
): Promise<Lead[]> {
  const capped = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const result =
    input.status === undefined
      ? await client.query<LeadRow>(
          `select id, title, contact_id, conversation_id, status, lost_reason, task_id, version::text from leads order by created_at limit $1`,
          [capped],
        )
      : await client.query<LeadRow>(
          `select id, title, contact_id, conversation_id, status, lost_reason, task_id, version::text from leads where status = $1 order by created_at limit $2`,
          [input.status, capped],
        );
  return result.rows.map(toLead);
}
