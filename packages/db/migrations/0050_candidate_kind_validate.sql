-- 0050 — validate the widened candidate kind CHECK (P07.04 round-1).
--
-- VALIDATE CONSTRAINT scans existing rows (all phone|email|external_id, hence satisfying the
-- wider list) under SHARE UPDATE EXCLUSIVE, concurrent-write-safe. Split into its own
-- migration because the runner holds one transaction per file (same shape as 0047+0048).

ALTER TABLE duplicate_candidates VALIDATE CONSTRAINT duplicate_candidates_kind_check;
