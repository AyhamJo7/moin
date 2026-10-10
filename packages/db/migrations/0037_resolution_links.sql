-- 0037 — deterministic identity resolution outputs (P07.03).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Resolution links, it never guesses
--
-- `resolve_caller` (below, in the service — no DEFINER here) matches an inbound identifier against
-- verified methods only. Its verdicts need somewhere to land:
--
-- `interaction_links` records what the resolver decided per interaction: the matched contact and
-- method, and the rule in owner-visible German ("erkannt über Rufnummer"). `no_match` rows are
-- recorded too — "looked, found nothing" is evidence, not absence of evidence, and it is what the
-- reconciler (P07.11) distinguishes from "never looked".
--
-- `duplicate_candidates` records the multi-match case: two or more contacts own the same verified
-- value (possible after imports/migrations predate the partial unique index). The resolver links
-- nothing — it records the candidate pair plus a review task and stops (INV-09: never a guess).
-- Merging is P07.04's human-approved job; this table is its inbox.
--
-- Both tables are tenant rows (organisation_id, composite keys, RLS + FORCE, moin_app DML).
-- The task for review reuses the minimal `tasks` table (0025, P07.06 owns the machine).

CREATE TABLE interaction_links (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  -- Opaque interaction reference (provider call SID, message id). Unique per tenant: one verdict
  -- per interaction; a re-resolve updates, never duplicates.
  interaction_ref text        NOT NULL CHECK (length(btrim(interaction_ref)) BETWEEN 1 AND 254),
  contact_id      uuid,
  method_id       uuid,
  -- none | phone | email | external_id. `none` = looked, found nothing (CLIR, unknown).
  rule            text        NOT NULL
                    CHECK (rule IN ('none', 'phone', 'email', 'external_id')),
  -- Owner-visible German label, e.g. 'erkannt über Rufnummer'. Stored, not computed, so what the
  -- owner saw is auditable later.
  label_de        text        NOT NULL CHECK (length(btrim(label_de)) BETWEEN 1 AND 100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, interaction_ref),
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, method_id) REFERENCES contact_methods (organisation_id, id) ON DELETE CASCADE,
  CHECK (
    (rule = 'none' AND contact_id IS NULL AND method_id IS NULL)
    OR (rule <> 'none' AND contact_id IS NOT NULL AND method_id IS NOT NULL)
  )
);

CREATE INDEX interaction_links_contact_idx ON interaction_links (organisation_id, contact_id)
  WHERE contact_id IS NOT NULL;

COMMENT ON TABLE interaction_links IS
  'Resolution verdicts per interaction (P07.03). Deterministic rules only (INV-09); no_match rows prove the resolver looked.';
COMMENT ON COLUMN interaction_links.interaction_ref IS 'Opaque caller-supplied interaction key (e.g. provider call SID); unique per tenant.';
COMMENT ON COLUMN interaction_links.rule IS 'none | phone | email | external_id: which verified method matched, or none.';
COMMENT ON COLUMN interaction_links.label_de IS 'Owner-visible German label of the match (e.g. erkannt über Rufnummer).';

CREATE TABLE duplicate_candidates (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  contact_a_id    uuid        NOT NULL,
  contact_b_id    uuid        NOT NULL,
  -- The verified value both contacts own (canonical form). Opaque pair key for dedup.
  kind            text        NOT NULL CHECK (kind IN ('phone', 'email', 'external_id')),
  value           text        NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 254),
  status          text        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'merged', 'dismissed')),
  -- Review task in `tasks` (0025 minimal shape): the human's inbox entry.
  review_task_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, kind, value, status),
  FOREIGN KEY (organisation_id, contact_a_id) REFERENCES contacts (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, contact_b_id) REFERENCES contacts (organisation_id, id) ON DELETE CASCADE,
  CHECK (contact_a_id <> contact_b_id)
);

CREATE INDEX duplicate_candidates_contacts_idx
  ON duplicate_candidates (organisation_id, contact_a_id, contact_b_id);

COMMENT ON TABLE duplicate_candidates IS
  'Multi-match inbox (P07.03.02, INV-09). The resolver links nothing on ambiguity; a human merges in P07.04.';
COMMENT ON COLUMN duplicate_candidates.value IS 'Canonical verified value both contacts own; opaque dedup key, never displayed raw in lists.';
COMMENT ON COLUMN duplicate_candidates.review_task_id IS 'Review task in tasks; NULL only if task creation failed (never silently — the write is transactional).';

SELECT app.apply_tenant_rls('interaction_links');
SELECT app.apply_tenant_rls('duplicate_candidates');

REVOKE ALL ON TABLE interaction_links, duplicate_candidates
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON interaction_links, duplicate_candidates TO moin_app;

-- Reviewed audit argument keys for resolution (P06.10.03, P06.10.07, INV-12). Rule markers and
-- counts only — the matched value itself never reaches an audit row.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('resolution.link', 'rule', 'count', 'matching rule as opaque marker (0=none,1=phone,2=email,3=external_id); no value'),
  ('resolution.no_match', 'rule', 'count', 'always 0 (none); records that the resolver looked'),
  ('resolution.candidate', 'rule', 'count', 'matching rule as opaque marker; the ambiguous value itself is not recorded')
ON CONFLICT (operation, argument_key) DO NOTHING;
