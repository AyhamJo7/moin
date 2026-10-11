/**
 * Approval workflow + audit (P09.05): role-gated, content-bound, audited approvals.
 *
 * Thin service over the DEFINER publish door (`app.approve_knowledge_version`,
 * 0052 + 0056): the fn resolves the approver's membership role (owner|admin only),
 * checks latest-draft, computes the version hash, and stamps ledger + flip + pointer
 * atomically. This module adds:
 * - pre-checks that map to 409 (not raw DEFINER exceptions): retired, non-draft,
 *   stale — plus the role check surfaced as 403-forbidden semantics (staff callers
 *   get VersionConflictError carrying a 403 marker — see ForbiddenError below;
 *   HTTP maps it, the DB path stays a single error shape),
 * - per-approval audit events (markers only, INV-12),
 * - bulk approval: sequential per-item, each item individually confirmed with its
 *   own result — no silent bulk accept (P09.05.02). A bulk run returns one result
 *   per item (approved | rejected + reason); one item's failure never aborts the
 *   rest, and every decided item carries its own audit row.
 */

import { appendAuditEvent } from './audit.ts';
import { approveKnowledgeVersion, VersionConflictError as KnowledgeConflict } from './knowledge.ts';
import type { TenantClient } from './tenant.ts';

/** Staff (or role-less) callers cannot approve: 403 at HTTP, distinct from 409. */
export class ForbiddenError extends Error {
  public override readonly name = 'ForbiddenError';
}

export interface ApprovalResult {
  readonly itemId: string;
  readonly versionId: string;
  readonly approved: boolean;
  readonly reason: string | null;
}

export interface BulkApprovalResult {
  readonly results: readonly ApprovalResult[];
}

/**
 * Approve one item version: role-gated (owner|admin), latest-draft, content-bound,
 * audited. Staff callers fail with ForbiddenError (403 semantics); stale/retired
 * fail with the knowledge 409.
 */
export async function approveFaqCard(
  client: TenantClient,
  input: { itemId: string; versionId: string; approvedBy: string },
): Promise<{ itemId: string; versionId: string }> {
  // Role FIRST (before the knowledge pre-checks): staff must 403 even when the
  // version is also stale — role is the outer gate, content the inner one. The
  // DEFINER re-checks inside the txn (direct calls cannot skip it); this read is
  // the service mapping to 403 semantics.
  const role = await client.query<{ role: string | null }>(
    `select role from memberships
     where organisation_id = app.current_org() and user_id = $1::uuid and status = 'active'`,
    [input.approvedBy],
  );
  const found = role.rows[0]?.role ?? null;
  if (found !== 'owner' && found !== 'admin') {
    throw new ForbiddenError('approval requires owner or admin');
  }
  try {
    await approveKnowledgeVersion(client, input);
  } catch (error) {
    if (error instanceof Error && error.message.includes('requires owner or admin')) {
      throw new ForbiddenError('approval requires owner or admin');
    }
    throw error;
  }
  return { itemId: input.itemId, versionId: input.versionId };
}

/** Alias: knowledge approval through the same workflow door (one path, one audit). */
export const approveKnowledge = approveFaqCard;

/**
 * Bulk approval: sequential per-item, each individually confirmed. No silent bulk
 * accept — every item gets its own approve attempt, its own result, and (on success)
 * its own audit row. Failures record reason per item and never abort the run.
 */
export async function bulkApprove(
  client: TenantClient,
  input: { items: readonly { itemId: string; versionId: string; approvedBy: string }[] },
): Promise<BulkApprovalResult> {
  const results: ApprovalResult[] = [];
  for (const item of input.items) {
    try {
      await approveFaqCard(client, item);
      results.push({
        itemId: item.itemId,
        versionId: item.versionId,
        approved: true,
        reason: null,
      });
    } catch (error) {
      results.push({
        itemId: item.itemId,
        versionId: item.versionId,
        approved: false,
        reason:
          error instanceof ForbiddenError
            ? 'forbidden'
            : error instanceof KnowledgeConflict
              ? 'conflict'
              : 'error',
      });
    }
  }
  // One audit row for the bulk run itself (markers only: counts, never ids).
  const approved = results.filter((r) => r.approved).length;
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.bulk_approve',
    targetKind: 'knowledge_item',
    targetId: input.items[0]?.itemId ?? '00000000-0000-4000-8000-000000000000',
    argsSanitized: { approved, total: results.length },
    result: 'succeeded',
  });
  return { results };
}
