-- 0049 — duplicate candidates (P07.04.01 signals) + contact merge ledger (P07.04.02/03).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## Candidate signals (deterministic; AI similarity is suggestion-only, stored nowhere)
--
-- `duplicate_candidates` (0037) already covers the resolver's multi-match inbox
-- (kind + value + status). P07.04.01 adds two deterministic signals that do NOT need a
-- shared verified value:
-- - `name_postal`: same normalised display name + same postal code carried on the candidate
--   row itself (`signal_name`, `signal_postal`). Contacts carry no PLZ column (it lives on
--   locations/notes free text), so the signal inputs are caller-supplied at suggestion time,
--   matched case-insensitively on the NFC-normalised name — exactly what PersonName stores.
-- - `email_local`: same email local part on different domains (anna@a.de vs anna@b.de).
--   The normalised local part is the dedup key; domains may legitimately differ (provider
--   move), so this is a suggestion, never an auto-merge.
-- - `ai_similarity`: a stub flag a future P10 model may set. It changes NOTHING about
--   merge authority: merges are human-approved, always (INV-09). No AI call exists here.
--
-- The 0037 `UNIQUE (organisation_id, kind, value, status)` cannot serve signal rows (their
-- `value` is derived, not a shared verified value), so signal rows carry their own partial
-- unique per kind below. `status` stays open | dismissed for signal rows; a resolved
-- suggestion is DELETED with the loser (see legs below), and the merge ledger keeps the
-- candidate id — the inbox is a worklist, not evidence.
--
-- ## Merge ledger (`contact_merges`): the human-approved move, reversible in 30 days
--
-- A merge moves methods + links from loser → winner, then DELETES the loser row (a kept
-- loser would keep resolving). The ledger records what moved (method ids, link ids, task
-- ids, lead ids, request ids, note ids) so unmerge within 30 days can move them back.
-- After 30 days the record is history, not a handle (unmerge refused). The loser id is
-- kept for audit; re-creating it on unmerge uses a FRESH id — the old row is gone and
-- UUIDs are never recycled.
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML (no DELETE
-- on merges: the ledger is append-only like interactions; erasure runs privileged).

-- The candidate's contact legs CASCADE on contact delete (0037): merging deletes the
-- loser row, which deletes the candidate row with it (verified by probe). That is the
-- CORRECT shape: the inbox is a worklist, and a resolved suggestion is consumed — the
-- merge ledger keeps the candidate id, the audit row keeps the signal marker. So the
-- merge deletes the candidate explicitly with the loser (one statement, same
-- transaction), and no leg rewrite is attempted: RESTRICT legs would refuse the loser
-- delete, and NOT NULL + distinct-legs CHECK forbid re-pointing. A candidate whose
-- contact is deleted any other way (erasure) vanishes with it — correct, since its
-- subject is gone.
-- Signal columns on the existing inbox (nullable: resolver rows predate them).
-- The 0037 kind CHECK (phone|email|external_id) cannot hold signal rows: drop and re-add
-- widened. Expand-only (widening a CHECK never breaks an old reader), no backfill
-- (existing rows keep their resolver kinds), and the re-add is NOT VALID (the check's
-- 120-character lookahead cannot see past the value list) with validation in 0050.
ALTER TABLE duplicate_candidates DROP CONSTRAINT duplicate_candidates_kind_check;
ALTER TABLE duplicate_candidates ADD CONSTRAINT duplicate_candidates_kind_check
  CHECK (kind IN ('phone', 'email', 'external_id', 'name_postal', 'email_local', 'ai_similarity')) NOT VALID;
ALTER TABLE duplicate_candidates ADD COLUMN signal_name text;
ALTER TABLE duplicate_candidates ADD COLUMN signal_postal text;
ALTER TABLE duplicate_candidates ADD COLUMN signal_local text;
ALTER TABLE duplicate_candidates ADD COLUMN ai_suggested boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN duplicate_candidates.signal_name IS 'NFC-normalised display name for name_postal signal; NULL for other kinds.';
COMMENT ON COLUMN duplicate_candidates.signal_postal IS 'Five-digit PLZ for name_postal signal; NULL for other kinds.';
COMMENT ON COLUMN duplicate_candidates.signal_local IS 'Lowercased email local part for email_local signal; NULL for other kinds.';
COMMENT ON COLUMN duplicate_candidates.ai_suggested IS 'P10 similarity stub: suggestion flag only, never merge authority (INV-09).';

-- One open suggestion per signal pair: same contacts + same kind collide while open
-- (dedupes repeat suggestions; the 0037 (kind, value, status) unique serves resolver rows).
CREATE UNIQUE INDEX duplicate_candidates_signal_unique_idx
  ON duplicate_candidates (organisation_id, contact_a_id, contact_b_id, kind)
  WHERE status = 'open' AND kind IN ('name_postal', 'email_local', 'ai_similarity');

CREATE TABLE contact_merges (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  -- Winner keeps its row; loser row is deleted after the move.
  winner_id       uuid        NOT NULL,
  loser_id        uuid        NOT NULL,
  -- Who approved (staff user id, opaque) and which candidate suggested it (nullable: a
  -- human may merge without a prior suggestion; loose reference, no FK — the candidate
  -- row is consumed by the merge and may be gone while the ledger lives on).
  approved_by     uuid        NOT NULL,
  candidate_id    uuid,
  -- Moved row ids (empty arrays, never NULL): methods, links, tasks, leads, requests, notes.
  -- Conversations and calls get their own columns (not folded into links): their contact
  -- legs move by UPDATE like the other tables, while interaction_links rows are deleted
  -- and re-created (triple-FK), so unmerge must tell the two shapes apart.
  moved_method_ids uuid[]     NOT NULL DEFAULT '{}',
  moved_link_ids   uuid[]     NOT NULL DEFAULT '{}',
  moved_conversation_ids uuid[] NOT NULL DEFAULT '{}',
  moved_call_ids   uuid[]     NOT NULL DEFAULT '{}',
  moved_task_ids   uuid[]     NOT NULL DEFAULT '{}',
  moved_lead_ids   uuid[]     NOT NULL DEFAULT '{}',
  moved_request_ids uuid[]    NOT NULL DEFAULT '{}',
  moved_note_ids   uuid[]     NOT NULL DEFAULT '{}',
  -- Unmerge window: 30 days from merge. After that the record is history.
  merged_at       timestamptz NOT NULL DEFAULT now(),
  unmerged_at     timestamptz,
  undone          boolean     NOT NULL DEFAULT false,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, winner_id) REFERENCES contacts (organisation_id, id) ON DELETE CASCADE,
  CHECK (winner_id <> loser_id),
  CHECK (undone = false OR unmerged_at IS NOT NULL)
);

CREATE INDEX contact_merges_winner_idx ON contact_merges (organisation_id, winner_id);
CREATE INDEX contact_merges_loser_idx ON contact_merges (organisation_id, loser_id)
  WHERE undone = false;

COMMENT ON TABLE contact_merges IS 'Human-approved contact merges (P07.04.02, INV-09). Winner keeps its row; loser deleted after the move; reversible in 30 days (P07.04.03).';
COMMENT ON COLUMN contact_merges.moved_method_ids IS 'Method ids moved loser→winner; empty array when none moved.';
COMMENT ON COLUMN contact_merges.approved_by IS 'Staff user who approved; opaque id, never a name (INV-12).';

SELECT app.apply_tenant_rls('contact_merges');

REVOKE ALL ON TABLE contact_merges
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- No DELETE: the ledger is append-only; erasure (P16) runs privileged.
GRANT SELECT, INSERT, UPDATE ON contact_merges TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers and counts only.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('merge.suggest', 'signal', 'count', 'candidate signal as opaque marker (0=name_postal,1=email_local,2=ai_similarity); no names or values'),
  ('merge.apply', 'moved', 'count', 'total rows moved+observed across methods, links, conversations, calls, tasks, leads, requests, notes; no ids or content'),
  ('merge.undo', 'restored', 'count', 'rows restored, by table count bucket; no ids or content')
ON CONFLICT (operation, argument_key) DO NOTHING;
