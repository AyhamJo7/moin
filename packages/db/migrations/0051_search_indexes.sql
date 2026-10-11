-- 0051 — full-text + trigram search indexes (P07.12.01).
-- migration-check: allow create-index-blocking because every index here is an expression
-- GIN over existing tables but built in the same window as the feature that reads them:
-- no prior release queries these expressions, so no running code depends on their absence,
-- and expression indexes need no backfill (computed at index time, no column rewrite).
--
-- ## What is indexed, and why this shape
--
-- Contacts (display_name), tasks (title), notes (body): German full-text via
-- `to_tsvector('german', …)` — the german dictionary stems (Müller/Müllern match) and
-- folds ß (Straße/Strasse match at the lexeme level). Umlaut INSENSITIVITY across
-- spellings (Müller vs Muller) is NOT a german-dict behaviour, so the service adds a
-- trgm-similarity leg over `unaccent(lower(…))` at SELECT time.
--
-- Index/predicate alignment (verified by probe, not by hope):
-- - `to_tsvector('german', col)` GINs fire on the FTS legs (exact predicate match).
-- - `lower(display_name)` trgm GIN does NOT prune the unaccent-wrapped similarity
--   leg: `unaccent` is STABLE (provolitile = s, probe-verified), and STABLE functions
--   are banned from index expressions (42P17, probe-verified) — so no index can ever
--   match the `unaccent(lower(col))` predicate exactly. The trgm leg is a SELECT-time
--   recheck and seq-scans at pilot scale; accepted deliberately, revisit past ~100k
--   contacts (options: immutable unaccent wrapper, or a generated column + trigger).
-- - `contact_methods.value` trgm GIN DOES fire on the phone leg: `replace()` is
--   IMMUTABLE, so the index on the exact folded expression
--   `replace(replace(replace(value, ' ', ''), '-', ''), '+', '')` matches the
--   predicate verbatim (EXPLAIN Bitmap Index Scan, probe-verified).
-- - Phone folding strips spaces, dashes and `+` on BOTH sides (stored value and
--   query): `+49 30 …` matches a `+4930…` query and vice versa. Slashes/dots are NOT
--   folded (values never contain them; keep the expression minimal).
--
-- Extension provisioning: `unaccent` (like pg_trgm, vector, pgcrypto, citext) is
-- created by the cluster init script + test harness, NOT by this migration —
-- probe-verified: the migrator role gets `permission denied to create extension`
-- on a missing extension (no CREATE privilege on the database). Production RDS
-- provisioning is P05/EXT-09's track (flagged in EV-P07-017); the service degrades
-- honestly without it (42883 surfaces, never wrong results).
--
-- Expression GIN (not generated columns): no table rewrite, no backfill job, no
-- expand/contract column dance — the index computes the expression.
--
-- No RLS change: indexes do not bypass policies. No new table, no constraints, no
-- backfill. The search service reads through withTenant, so every hit is tenant-scoped.

CREATE INDEX contacts_name_fts_idx
  ON contacts USING gin (to_tsvector('german', display_name));

-- Supports ILIKE-prefix-style trgm reuse where the predicate does not wrap unaccent
-- (kept for future prefix legs); the unaccent similarity leg seq-scans (see above).
CREATE INDEX contacts_name_trgm_idx
  ON contacts USING gin (lower(display_name) gin_trgm_ops);

CREATE INDEX tasks_title_fts_idx
  ON tasks USING gin (to_tsvector('german', title));

CREATE INDEX notes_body_fts_idx
  ON notes USING gin (to_tsvector('german', body))
  WHERE deleted_at IS NULL;

-- Exact predicate match: the phone leg folds value and $1 with the identical
-- replace-chain (spaces, dashes, plus), so this index prunes (EXPLAIN-verified).
CREATE INDEX contact_methods_value_trgm_idx
  ON contact_methods USING gin
    (replace(replace(replace(value, ' ', ''), '-', ''), '+', '') gin_trgm_ops);

COMMENT ON INDEX contacts_name_fts_idx IS 'German FTS over contact names (P07.12.01). Stemming + ß-folding via the german dictionary; fires on the FTS leg.';
COMMENT ON INDEX contacts_name_trgm_idx IS 'Trigram over lower(display_name) (P07.12.01). Does NOT prune the unaccent() similarity leg (STABLE banned from index exprs) — seq-scan accepted at pilot scale.';
COMMENT ON INDEX contact_methods_value_trgm_idx IS 'Trigram over space/dash/plus-folded method values (P07.12.01). Exact predicate match — prunes the phone leg (EXPLAIN-verified).';

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Length marker only —
-- the query text itself NEVER reaches an audit row.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('search.query', 'query_len', 'count', 'query length bucket only; the query text never reaches audit (INV-12)'),
  ('search.query', 'scope', 'count', 'searched scope as opaque marker (0=contacts,1=tasks,2=notes,3=all); no content')
ON CONFLICT (operation, argument_key) DO NOTHING;
