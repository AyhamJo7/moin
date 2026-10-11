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
-- spellings (Müller vs Muller) is NOT a german-dict behaviour, so a second trgm GIN on
-- `unaccent(lower(…))` covers fuzzy prefix/typo matching on names. Phone digits are not
-- words: `contact_methods.value` gets a trgm GIN for partial-digit LIKE matching
-- ('030 12' finds '+49 30 123…'), applied on the digit-folded value.
--
-- Expression GIN (not generated columns): no table rewrite, no backfill job, no
-- expand/contract column dance — the index computes the expression. unaccent is STABLE,
-- not IMMUTABLE, so it cannot appear in an index expression: the trgm index is on
-- lower(display_name) and the query folds unaccent at SELECT time (index still prunes
-- on the raw trigrams; unaccent applies as a recheck-friendly filter via similarity).
-- The extension itself is created by the cluster init / test harness (same split as
-- pg_trgm, vector, pgcrypto, citext — CREATE EXTENSION needs privileges the migration
-- role lacks).
--
-- No RLS change: indexes do not bypass policies. No new table, no constraints, no
-- backfill. The search service reads through withTenant, so every hit is tenant-scoped.

CREATE INDEX contacts_name_fts_idx
  ON contacts USING gin (to_tsvector('german', display_name));

CREATE INDEX contacts_name_trgm_idx
  ON contacts USING gin (lower(display_name) gin_trgm_ops);

CREATE INDEX tasks_title_fts_idx
  ON tasks USING gin (to_tsvector('german', title));

CREATE INDEX notes_body_fts_idx
  ON notes USING gin (to_tsvector('german', body))
  WHERE deleted_at IS NULL;

CREATE INDEX contact_methods_value_trgm_idx
  ON contact_methods USING gin (value gin_trgm_ops);

COMMENT ON INDEX contacts_name_fts_idx IS 'German FTS over contact names (P07.12.01). Stemming + ß-folding via the german dictionary.';
COMMENT ON INDEX contacts_name_trgm_idx IS 'Trigram over unaccented contact names (P07.12.01). Umlaut-variant + typo matching FTS cannot do.';
COMMENT ON INDEX contact_methods_value_trgm_idx IS 'Trigram over method values (P07.12.01). Partial phone-digit matching.';

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Length marker only —
-- the query text itself NEVER reaches an audit row.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('search.query', 'query_len', 'count', 'query length bucket only; the query text never reaches audit (INV-12)'),
  ('search.query', 'scope', 'count', 'searched scope as opaque marker (0=contacts,1=tasks,2=notes,3=all); no content')
ON CONFLICT (operation, argument_key) DO NOTHING;
