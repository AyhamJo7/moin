-- 0046 — no-lost-interaction reconciler support (P07.11.02).
-- migration-check: allow create-index-blocking because the index is partial over open
-- conversations only (small, hot set), so the brief lock is smaller than a second migration.
--
-- ## Why no claim function here
--
-- The sweep pages tenants through the reviewed `app.claim_audit_chains` (global register, no
-- RLS) and checks each tenant's orphans inside `withTenant` — a claim function over
-- `conversations` directly cannot work: SECURITY DEFINER changes *who* runs it, but FORCE RLS
-- still applies to that user, and the owner is NOBYPASSRLS, so with no tenant context it sees
-- nothing. Verified by probe: the same WHERE clause returns the row inside `withTenant` and
-- nothing through a tenant-less claim. The per-tenant orphan check therefore lives in
-- `finaliser.ts` (plain SQL under the policy), and this migration provides only the index
-- that keeps it from seq-scanning every open conversation, plus the audit allowlist row.
--
-- ## What is orphaned
--
-- A conversation still open (or needs_action) after the age cutoff with neither an outcome
-- row nor a linked open task. Fresh interactions are excluded by age: the live call or the
-- in-flight finaliser owns them. `updated_at` (not created_at) is the clock: a conversation
-- actively worked on never ages into the claim. The fallback task itself counts as the open
-- task, so a double-run finds its own prior work and no-ops.

CREATE INDEX conversations_orphan_claim_idx ON conversations (updated_at)
  WHERE status IN ('open', 'needs_action');

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers and counts only.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('interaction.finalise', 'verdict', 'count', '0=outcome-existed,1=task-existed,2=fallback-created; no callback data')
ON CONFLICT (operation, argument_key) DO NOTHING;
