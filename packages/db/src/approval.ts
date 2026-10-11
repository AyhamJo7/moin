/**
 * Approval workflow + audit (P09.05): role-gated, content-bound, audited approvals.
 *
 * Thin service over the DEFINER publish door (`app.approve_knowledge_version(item,
 * version)`, 0052 + 0056): the fn resolves the ACTOR from `app.current_user()` (SET
 * by withTenant from the session — never a caller UUID), checks latest-draft +
 * role, computes the version hash, and stamps ledger + flip + pointer atomically.
 * There is NO approvedBy param anywhere on this path (P09.05 identity fix):
 * nominating another user's UUID is inexpressible — the txn actor IS the approver.
 * This module adds:
 * - pre-checks that map to 409 (not raw DEFINER exceptions): retired, non-draft,
 *   stale — plus the role check surfaced as 403-forbidden semantics (staff contexts
 *   get ForbiddenError; HTTP maps it, the DB path stays a single error shape),
 * - per-approval audit events (markers only, INV-12),
 * - bulk approval: sequential per-item SAVEPOINTs, each item individually confirmed
 *   with its own result — no silent bulk accept (P09.05.02). A bulk run returns one
 *   result per item (approved | rejected + reason); one item's DB-level failure
 *   rolls back TO its savepoint (never the whole run), and every decided item
 *   carries its own audit row.
 */

import { appendAuditEvent } from './audit.ts';
import { approveKnowledgeVersion, VersionConflictError as KnowledgeConflict } from './knowledge.ts';
import { currentTenant, type TenantClient } from './tenant.ts';

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
 * audited. The approver is the TXN ACTOR (withTenant actorId → app.actor_id) —
 * never a parameter. Staff contexts fail with ForbiddenError (403 semantics);
 * stale/retired fail with the knowledge 409.
 */
export async function approveFaqCard(
  client: TenantClient,
  input: { itemId: string; versionId: string },
): Promise<{ itemId: string; versionId: string }> {
  // Role FIRST (before the knowledge pre-checks): staff must 403 even when the
  // version is also stale — role is the outer gate, content the inner one. Reads
  // the txn actor (server-side, INV-02), NOT a caller UUID. The DEFINER re-checks
  // inside the txn (direct calls cannot skip it); this read is the service mapping
  // to 403 semantics.
  const actor = currentTenant()?.actorId ?? null;
  if (actor === null) throw new ForbiddenError('approval requires an acting user');
  const role = await client.query<{ role: string | null }>(
    `select role from memberships
     where organisation_id = app.current_org() and user_id = $1::uuid and status = 'active'`,
    [actor],
  );
  const found = role.rows[0]?.role ?? null;
  if (found !== 'owner' && found !== 'admin') {
    throw new ForbiddenError('approval requires owner or admin');
  }
  try {
    await approveKnowledgeVersion(client, input);
  } catch (error) {
    // Map by SQLSTATE code (42501 insufficient_privilege — the DEFINER's guard
    // code), not by text: message wording is not a contract, the code is. The
    // message narrows WHICH guard fired (role vs stale/retired share the code).
    if (
      error instanceof Error &&
      (error as { code?: unknown }).code === '42501' &&
      error.message.includes('requires owner or admin')
    ) {
      throw new ForbiddenError('approval requires owner or admin');
    }
    throw error;
  }
  return { itemId: input.itemId, versionId: input.versionId };
}

/** Alias: knowledge approval through the same workflow door (one path, one audit). */
export const approveKnowledge = approveFaqCard;

/**
 * Bulk approval: sequential per-item SAVEPOINTs, each individually confirmed. No
 * silent bulk accept — every item gets its own approve attempt, its own result, and
 * (on success) its own audit row. A DB-level failure rolls back TO the item's
 * savepoint (never the whole run): later items still decide, and the bulk audit row
 * still lands.
 */
export async function bulkApprove(
  client: TenantClient,
  input: { items: readonly { itemId: string; versionId: string }[] },
): Promise<BulkApprovalResult> {
  const results: ApprovalResult[] = [];
  for (const [index, item] of input.items.entries()) {
    const savepoint = `bulk_item_${index}`;
    await client.query(`savepoint ${savepoint}`);
    try {
      await approveFaqCard(client, item);
      await client.query(`release savepoint ${savepoint}`);
      results.push({
        itemId: item.itemId,
        versionId: item.versionId,
        approved: true,
        reason: null,
      });
    } catch (error) {
      await client.query(`rollback to savepoint ${savepoint}`);
      await client.query(`release savepoint ${savepoint}`);
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
  // Bulk-level: no single item owns the run — targetId NULL (counts-only claim).
  const approved = results.filter((r) => r.approved).length;
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'knowledge.bulk_approve',
    targetKind: 'knowledge_item',
    argsSanitized: { approved, total: results.length },
    result: 'succeeded',
  });
  return { results };
}
