/**
 * Tool registry and execution guard (P10.08, INV-04/05/09/11).
 *
 * `defineTool` declares the contract; `guardedExecute` runs the pipeline:
 * tenant → allowed → permission → schema → preconditions → ownership →
 * idempotency → approval → execute → audit → result token.
 *
 * Deliberately storage-free: idempotency keys, approvals and audit live in
 * the database behind the caller's ports (`checkIdempotency`,
 * `isApproved`, `recordAudit`). This module owns the *order* of checks and
 * nothing else — the first version that stored keys in a Map shipped a
 * cross-restart duplicate-execution hole, caught in review. Persistence is
 * the caller's job; ordering is ours.
 *
 * INV-05: `create*` tools return a result token bound to the invocation; the
 * caller needs it for COMMITMENT templates. `COMMITMENT_WITHOUT_TOKEN`
 * (`commitment.without_token`) must stay 0 — the guard never produces a
 * commitment-shaped value without a token; unknown outcomes reconcile
 * (P10.08.04: `reconcileUnknown`), they never resolve optimistically.
 */

import type { ZodType } from 'zod';

export type ToolChannel = 'voice' | 'web' | 'staff';

/** Every refusal the guard can produce — a union so callers handle each. */
export type GuardRejection =
  | 'tool-not-allowed'
  | 'missing-permission'
  | 'invalid-args'
  | 'precondition-failed'
  | 'wrong-owner'
  | 'duplicate-key'
  | 'approval-required';

export interface ToolDef<TArgs = unknown> {
  readonly name: string;
  readonly schema: ZodType<TArgs>;
  /** Permission the caller's subject must hold. */
  readonly permission: string;
  readonly channels: readonly ToolChannel[];
  /** Sync predicates over validated args; first false rejects. */
  readonly preconditions: readonly ((args: TArgs) => boolean)[];
  /** Resource owner the args must belong to (ownership step). */
  readonly ownerOf?: ((args: TArgs) => string) | undefined;
  /** True when the tool needs a human approval before executing. */
  readonly requiresApproval: boolean;
  /** Strip PII before the audit row is written (INV-12). */
  readonly sanitiseAudit: (args: TArgs) => Record<string, unknown>;
}

export function defineTool<TArgs>(def: ToolDef<TArgs>): ToolDef<TArgs> {
  return def;
}

export interface GuardPorts {
  readonly tenantAllowsTool: (tenantId: string, toolName: string) => boolean;
  readonly subjectHasPermission: (subject: string, permission: string) => boolean;
  readonly callerOwns: (caller: string, owner: string) => boolean;
  readonly checkIdempotency: (key: string) => 'fresh' | 'duplicate';
  readonly isApproved: (key: string) => boolean;
  readonly recordAudit: (entry: Record<string, unknown>) => void;
  readonly execute: (
    toolName: string,
    args: unknown,
  ) => Promise<'succeeded' | 'failed' | 'unknown'>;
}

export interface GuardCall {
  readonly tenantId: string;
  readonly channel: ToolChannel;
  readonly subject: string;
  readonly caller: string;
  readonly idempotencyKey: string;
  readonly args: unknown;
}

export interface ResultToken {
  readonly toolName: string;
  readonly idempotencyKey: string;
  readonly state: 'succeeded' | 'failed' | 'unknown';
}

/** Metric that must stay 0: commitments emitted without a token (INV-05). */
export const COMMITMENT_WITHOUT_TOKEN = 'commitment.without_token';

export type GuardOutcome =
  | { readonly ok: true; readonly token: ResultToken }
  | { readonly ok: false; readonly rejection: GuardRejection };

export async function guardedExecute<TArgs>(
  tool: ToolDef<TArgs>,
  call: GuardCall,
  ports: GuardPorts,
): Promise<GuardOutcome> {
  if (!ports.tenantAllowsTool(call.tenantId, tool.name) || !tool.channels.includes(call.channel)) {
    return { ok: false, rejection: 'tool-not-allowed' };
  }
  if (!ports.subjectHasPermission(call.subject, tool.permission)) {
    return { ok: false, rejection: 'missing-permission' };
  }
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) return { ok: false, rejection: 'invalid-args' };
  if (tool.preconditions.some((p) => !p(parsed.data))) {
    return { ok: false, rejection: 'precondition-failed' };
  }
  if (tool.ownerOf !== undefined && !ports.callerOwns(call.caller, tool.ownerOf(parsed.data))) {
    return { ok: false, rejection: 'wrong-owner' };
  }
  if (ports.checkIdempotency(call.idempotencyKey) === 'duplicate') {
    return { ok: false, rejection: 'duplicate-key' };
  }
  if (tool.requiresApproval && !ports.isApproved(call.idempotencyKey)) {
    return { ok: false, rejection: 'approval-required' };
  }
  const state = await ports.execute(tool.name, parsed.data);
  ports.recordAudit({
    tool: tool.name,
    tenant: call.tenantId,
    state,
    args: tool.sanitiseAudit(parsed.data),
  });
  return { ok: true, token: { toolName: tool.name, idempotencyKey: call.idempotencyKey, state } };
}

/**
 * Unknown-state reconciliation (P10.08.04): re-check, never assume. Returns
 * the verified state, or null when it is still unknown — the caller raises
 * the human task.
 */
export async function reconcileUnknown(
  recheck: () => Promise<'succeeded' | 'failed' | 'unknown'>,
): Promise<'succeeded' | 'failed' | null> {
  const state = await recheck();
  return state === 'unknown' ? null : state;
}
