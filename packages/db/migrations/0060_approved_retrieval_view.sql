-- 0060 — approved-only retrieval view (P09.09 PILOT).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What this adds
--
-- `knowledge_approved_current`: the ONLY assistant retrieval source (P09.09.01).
-- One row per servable knowledge version: approved + valid + not suspended +
-- not conflicted + overdue-restricted suppressed — the exact predicate the
-- service layer enforces in getLiveVersion/servedState, now ALSO as a SQL
-- view so direct readers (analytics, later voice adapters) cannot drift.
-- The view is versioned by migration number: 0060 defines v1; a future
-- change ships a new migration (never CREATE OR REPLACE in place without
-- one — the retrieval exclusion suite pins the semantics).
--
-- RLS: views do not carry policies — the base tables do (FORCE). The view
-- runs with the caller's rights (security_invoker), so tenant isolation
-- holds through the underlying FORCE RLS. No separate GRANT needed beyond
-- the base-table SELECT moin_app already holds; grant USAGE explicitly for
-- the catalog check.
--
-- pgvector HNSW passages are SELL (P09.09.04) — deferred, no columns here.

CREATE OR REPLACE VIEW knowledge_approved_current
WITH (security_invoker = true)
AS
SELECT
  v.organisation_id,
  v.item_id,
  v.id AS version_id,
  v.version_no,
  v.title,
  v.body,
  v.sensitivity,
  v.category,
  v.valid_until,
  a.decided_at AS approved_at
FROM knowledge_versions v
JOIN knowledge_items i
  ON i.organisation_id = v.organisation_id AND i.id = v.item_id
LEFT JOIN knowledge_approvals a
  ON a.organisation_id = v.organisation_id AND a.version_id = v.id
WHERE v.state = 'approved'
  AND i.state = 'approved'
  AND NOT i.suspended
  AND i.conflict_state = 'clear'
  AND coalesce(v.valid_until < CURRENT_DATE, false) = false
  AND NOT (
    v.sensitivity = 'restricted'
    AND coalesce(a.decided_at + v.reverify_after <= now(), false) = true
  );

COMMENT ON VIEW knowledge_approved_current IS 'Approved-only retrieval source v1 (P09.09.01, migration 0060): approved + valid + not suspended + not conflicted + overdue-restricted suppressed. The ONLY source assistant retrieval may read; service filters mirror it. pgvector passages are SELL — deferred.';

GRANT SELECT ON knowledge_approved_current TO moin_app;
