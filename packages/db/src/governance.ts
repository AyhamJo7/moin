/**
 * Governance records (P07.10): whose action it was, and what may be purged.
 *
 * Every tool invocation names exactly one actor (AI action xor staff user) — unattributable
 * executions cannot be inserted (DB CHECK). Invocations land `unknown` and report exactly once.
 * TTL is a column (`expires_at`, NULL = retain), not a scheduler: the sweeper reads purge
 * candidates with `purgeCandidates` (expired, capped). Prompts, payloads, outputs and proposal
 * bodies NEVER reach these tables or the audit rows (INV-12): kinds, states and decisions are
 * closed catalogues mapped to opaque markers.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ActionKind = 'reply' | 'tool_call' | 'escalate' | 'handoff' | 'summarise' | 'classify';
export type InvocationState = 'unknown' | 'succeeded' | 'failed' | 'rejected';
export type ProposalKind = 'send_message' | 'book' | 'cancel' | 'refund' | 'share_data' | 'other';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** Version or transition conflicts surface as 409 at the HTTP layer. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const KIND_MARKER: Record<ActionKind, number> = {
  reply: 0,
  tool_call: 1,
  escalate: 2,
  handoff: 3,
  summarise: 4,
  classify: 5,
};

const STATE_MARKER: Record<Exclude<InvocationState, 'unknown'>, number> = {
  succeeded: 1,
  failed: 2,
  rejected: 3,
};

const DECISION_MARKER: Record<Exclude<ApprovalStatus, 'pending'>, number> = {
  approved: 1,
  rejected: 2,
  expired: 3,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkflowRun {
  readonly id: string;
  readonly status: RunStatus;
  readonly conversationId: string | null;
  readonly version: number;
}

export interface AiAction {
  readonly id: string;
  readonly kind: ActionKind;
  readonly workflowRunId: string | null;
}

export interface ToolInvocation {
  readonly id: string;
  readonly state: InvocationState;
  readonly aiActionId: string | null;
  readonly actorUserId: string | null;
}

export interface HumanApproval {
  readonly id: string;
  readonly status: ApprovalStatus;
  readonly decidedBy: string | null;
}

export async function startRun(
  client: TenantClient,
  input: {
    conversationId?: string | undefined;
    correlationId?: string | undefined;
    expiresAt?: Date | undefined;
  },
): Promise<WorkflowRun> {
  if (input.correlationId !== undefined && !UUID_RE.test(input.correlationId)) {
    throw new RangeError('correlation must be a uuid');
  }
  const id = randomUUID();
  const result = await client.query<{
    id: string;
    status: string;
    conversation_id: string | null;
    version: string;
  }>(
    `insert into workflow_runs (organisation_id, id, conversation_id, correlation_id, expires_at)
     values (app.current_org(), $1, $2, $3, $4)
     returning id::text, status, conversation_id::text, version::text`,
    [
      id,
      input.conversationId ?? null,
      input.correlationId ?? null,
      input.expiresAt?.toISOString() ?? null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('run insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'run.start',
    targetKind: 'workflow_run',
    targetId: id,
    argsSanitized: { has_conversation: input.conversationId === undefined ? 0 : 1 },
    result: 'succeeded',
  });
  return {
    id: row.id,
    status: row.status as RunStatus,
    conversationId: row.conversation_id,
    version: Number(row.version),
  };
}

const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export async function finishRun(
  client: TenantClient,
  runId: string,
  status: Exclude<RunStatus, 'running'>,
  version: number,
): Promise<WorkflowRun> {
  const current = await client.query<{ status: string; version: string }>(
    `select status, version::text from workflow_runs where id = $1`,
    [runId],
  );
  const row = current.rows[0];
  if (row === undefined) throw new VersionConflictError(`run ${runId} not found`);
  if (!RUN_TRANSITIONS[row.status as RunStatus].includes(status)) {
    throw new VersionConflictError(`illegal run transition ${row.status} → ${status}`);
  }
  const moved = await client.query<{
    id: string;
    status: string;
    conversation_id: string | null;
    version: string;
  }>(
    `update workflow_runs set status = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and version = $3
     returning id::text, status, conversation_id::text, version::text`,
    [runId, status, version],
  );
  const next = moved.rows[0];
  if (next === undefined) throw new VersionConflictError(`run ${runId} version mismatch`);
  return {
    id: next.id,
    status: next.status as RunStatus,
    conversationId: next.conversation_id,
    version: Number(next.version),
  };
}

export async function recordAction(
  client: TenantClient,
  input: {
    kind: ActionKind;
    workflowRunId?: string | undefined;
    conversationId?: string | undefined;
    expiresAt?: Date | undefined;
  },
): Promise<AiAction> {
  const id = randomUUID();
  const result = await client.query<{ id: string }>(
    `insert into ai_actions (organisation_id, id, kind, workflow_run_id, conversation_id, expires_at)
     values (app.current_org(), $1, $2, $3, $4, $5)
     returning id::text`,
    [
      id,
      input.kind,
      input.workflowRunId ?? null,
      input.conversationId ?? null,
      input.expiresAt?.toISOString() ?? null,
    ],
  );
  if (result.rows[0] === undefined) throw new Error('action insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'action.record',
    targetKind: 'ai_action',
    targetId: id,
    argsSanitized: { kind: KIND_MARKER[input.kind] },
    result: 'succeeded',
  });
  return { id, kind: input.kind, workflowRunId: input.workflowRunId ?? null };
}

/**
 * Invoke a tool: exactly one actor (aiActionId xor actorUserId), state starts unknown.
 * Neither/nor and both/and are RangeError before SQL (the DB CHECK mirrors them).
 */
export async function invokeTool(
  client: TenantClient,
  input: {
    toolName: string;
    aiActionId?: string | undefined;
    actorUserId?: string | undefined;
    expiresAt?: Date | undefined;
  },
): Promise<ToolInvocation> {
  const name = input.toolName.trim();
  if (name.length === 0 || name.length > 120) throw new RangeError('tool name is empty');
  const byAi = input.aiActionId !== undefined;
  const byUser = input.actorUserId !== undefined;
  if (byAi === byUser) throw new RangeError('exactly one actor: AI action xor staff user');
  if (byUser && !UUID_RE.test(input.actorUserId ?? '')) {
    throw new RangeError('actor must be a user id');
  }
  const id = randomUUID();
  const result = await client.query<{ id: string }>(
    `insert into tool_invocations
       (organisation_id, id, ai_action_id, actor_user_id, tool_name, expires_at)
     values (app.current_org(), $1, $2, $3, $4, $5)
     returning id::text`,
    [
      id,
      input.aiActionId ?? null,
      input.actorUserId ?? null,
      name,
      input.expiresAt?.toISOString() ?? null,
    ],
  );
  if (result.rows[0] === undefined) throw new Error('invocation insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'tool.invoke',
    targetKind: 'tool_invocation',
    targetId: id,
    argsSanitized: { by_ai: byAi ? 1 : 0 },
    result: 'succeeded',
  });
  return {
    id,
    state: 'unknown',
    aiActionId: input.aiActionId ?? null,
    actorUserId: input.actorUserId ?? null,
  };
}

/** Report an invocation outcome: unknown → reported exactly once (guarded UPDATE). */
export async function reportInvocation(
  client: TenantClient,
  invocationId: string,
  state: Exclude<InvocationState, 'unknown'>,
): Promise<ToolInvocation> {
  const moved = await client.query<{
    id: string;
    ai_action_id: string | null;
    actor_user_id: string | null;
  }>(
    `update tool_invocations set state = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and state = 'unknown'
     returning id::text, ai_action_id::text, actor_user_id::text`,
    [invocationId, state],
  );
  const row = moved.rows[0];
  if (row === undefined) {
    throw new VersionConflictError(`invocation ${invocationId} already reported or missing`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'tool.report',
    targetKind: 'tool_invocation',
    targetId: invocationId,
    argsSanitized: { state: STATE_MARKER[state] },
    result: 'succeeded',
  });
  return { id: row.id, state, aiActionId: row.ai_action_id, actorUserId: row.actor_user_id };
}

export async function requestApproval(
  client: TenantClient,
  input: {
    proposalKind: ProposalKind;
    aiActionId?: string | undefined;
    expiresAt?: Date | undefined;
  },
): Promise<HumanApproval> {
  const id = randomUUID();
  const result = await client.query<{ id: string }>(
    `insert into human_approvals (organisation_id, id, proposal_kind, ai_action_id, expires_at)
     values (app.current_org(), $1, $2, $3, $4)
     returning id::text`,
    [id, input.proposalKind, input.aiActionId ?? null, input.expiresAt?.toISOString() ?? null],
  );
  if (result.rows[0] === undefined) throw new Error('approval insert returned no row');
  return { id, status: 'pending', decidedBy: null };
}

/** Decide a pending approval: names who decided. Decided rows never move again. */
export async function decideApproval(
  client: TenantClient,
  approvalId: string,
  input: { decision: Exclude<ApprovalStatus, 'pending'>; decidedBy: string; version: number },
): Promise<HumanApproval> {
  if (!UUID_RE.test(input.decidedBy)) throw new RangeError('decided_by must be a user id');
  const moved = await client.query<{ id: string; decided_by: string | null }>(
    `update human_approvals set status = $2, decided_by = $3, decided_at = clock_timestamp(),
       updated_at = clock_timestamp(), version = version + 1
     where id = $1 and status = 'pending' and version = $4
     returning id::text, decided_by::text`,
    [approvalId, input.decision, input.decidedBy, input.version],
  );
  const row = moved.rows[0];
  if (row === undefined) {
    throw new VersionConflictError(`approval ${approvalId} not pending at this version`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'approval.decide',
    targetKind: 'human_approval',
    targetId: approvalId,
    argsSanitized: { decision: DECISION_MARKER[input.decision] },
    result: 'succeeded',
  });
  return { id: row.id, status: input.decision, decidedBy: row.decided_by };
}

/**
 * Purge candidates for the sweeper: expired rows per table, capped. No scheduler here —
 * P08/P15 reads these shapes and deletes through its privileged path.
 */
export async function purgeCandidates(
  client: TenantClient,
  table: 'workflow_runs' | 'ai_actions' | 'tool_invocations' | 'human_approvals',
  limit = 100,
): Promise<string[]> {
  const capped = Math.min(Math.max(limit, 1), 1000);
  const expiredWhere =
    'where expires_at is not null and expires_at <= clock_timestamp() order by expires_at limit $1';
  const base = 'select id::text from';
  const result =
    table === 'workflow_runs'
      ? await client.query<{ id: string }>(`${base} workflow_runs ${expiredWhere}`, [capped])
      : table === 'ai_actions'
        ? await client.query<{ id: string }>(`${base} ai_actions ${expiredWhere}`, [capped])
        : table === 'tool_invocations'
          ? await client.query<{ id: string }>(`${base} tool_invocations ${expiredWhere}`, [capped])
          : await client.query<{ id: string }>(`${base} human_approvals ${expiredWhere}`, [capped]);
  return result.rows.map((r) => r.id);
}
