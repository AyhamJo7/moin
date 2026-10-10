-- 0044 — notes and the facts schema registry (P07.09.01, P07.09.02).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Notes: one table for three parents
--
-- `notes` attaches free text to contacts, tasks and leads. Exactly one parent per row (CHECK):
-- a note about two things is two notes. Author is a bare user id (never a membership FK, same
-- shape as tasks.assignee: the author may leave and the note stays). Soft delete via
-- `deleted_at` — history is never rewritten, only hidden. Audit rows carry counts/ids only;
-- note bodies never reach an audit row (INV-12: free text is the highest-risk payload here).
--
-- ## Facts schemas: versioned JSON Schemas with German rendering hints
--
-- `fact_schemas` is the registry the outcome writer (P07.05.03) was waiting for: one row per
-- (template, version) holding the JSON Schema the facts payload must validate against plus
-- German UI labels per field (`labels_de`). Schemas are immutable once created (no UPDATE grant
-- for moin_app): a new version is a new row, never an edit — a writer validating against v3
-- must see v3, not v3-as-amended. Until P10 templates exist, rows are seeded by migrations or
-- support tooling, not by the runtime role (INSERT allowed for future template sync; the
-- service layer restricts creation to reviewed shapes).
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML without
-- DELETE on notes (soft delete only; erasure runs privileged) and without UPDATE/DELETE on
-- fact_schemas (immutable registry).

CREATE TABLE notes (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  contact_id      uuid,
  task_id         uuid,
  lead_id         uuid,
  author_user_id  uuid,
  body            text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  deleted_at      timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, task_id) REFERENCES tasks (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, lead_id) REFERENCES leads (organisation_id, id) ON DELETE CASCADE,
  CHECK (
    (contact_id IS NOT NULL AND task_id IS NULL AND lead_id IS NULL)
    OR (contact_id IS NULL AND task_id IS NOT NULL AND lead_id IS NULL)
    OR (contact_id IS NULL AND task_id IS NULL AND lead_id IS NOT NULL)
  )
);

CREATE INDEX notes_contact_idx ON notes (organisation_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX notes_task_idx ON notes (organisation_id, task_id) WHERE task_id IS NOT NULL;
CREATE INDEX notes_lead_idx ON notes (organisation_id, lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON TABLE notes IS 'Free-text notes on contacts/tasks/leads (P07.09.01). Exactly one parent per row; soft delete only; bodies never reach audit rows.';
COMMENT ON COLUMN notes.author_user_id IS 'Bare user id of the author (may outlive the membership, like tasks.assignee_user_id).';
COMMENT ON COLUMN notes.deleted_at IS 'Soft delete: hidden, never rewritten. Erasure (P16) hard-deletes through its privileged path.';

CREATE TABLE fact_schemas (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  template        text        NOT NULL CHECK (length(btrim(template)) BETWEEN 1 AND 120),
  version         text        NOT NULL CHECK (version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  -- The JSON Schema the facts payload must validate against (draft 2020-12 subset the service
  -- enforces: object root, declared properties only, no $ref/$defs/dynamicRef).
  schema          jsonb       NOT NULL,
  -- German UI rendering hints per field: { "<field>": "<Label>" }. Labels only, no logic.
  labels_de       jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, template, version)
);

COMMENT ON TABLE fact_schemas IS 'Versioned facts schemas with German labels (P07.09.02). Immutable once created: new versions are new rows.';
COMMENT ON COLUMN fact_schemas.schema IS 'JSON Schema (object root, closed properties, no refs). Validated structurally at write time.';
COMMENT ON COLUMN fact_schemas.labels_de IS 'German field labels for the UI, e.g. {"name": "Name"}. Labels only.';

SELECT app.apply_tenant_rls('notes');
SELECT app.apply_tenant_rls('fact_schemas');

REVOKE ALL ON TABLE notes, fact_schemas
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- Notes: no DELETE (soft delete only). Schemas: immutable (no UPDATE/DELETE).
GRANT SELECT, INSERT, UPDATE ON notes TO moin_app;
GRANT SELECT, INSERT ON fact_schemas TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Counts only — never content.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('note.create', 'parent', 'count', 'parent kind as opaque marker (0=contact,1=task,2=lead); no body'),
  ('note.delete', 'deleted', 'count', 'always 1 (soft delete applied); no body'),
  ('facts.validate', 'valid', 'count', '1 when the payload validated, 0 when rejected; no payload')
ON CONFLICT (operation, argument_key) DO NOTHING;
