-- 0052 — knowledge model, lifecycle and versions (P09.01).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## Shape: item (mutable shell) + versions (immutable history) + approvals (ledger)
--
-- `knowledge_items` is the mutable shell: one row per card/FAQ, carrying the CURRENT
-- live version pointer (`live_version_id`, NULL until first approval) and the lifecycle
-- state (draft | approved | retired). `knowledge_versions` is append-only history with
-- exactly one permitted write: the draft→approved flip on approval (guarded UPDATE,
-- state='draft' in the WHERE clause — an approved row never matches again).
-- `knowledge_approvals` records who approved which version when (append-only like the
-- audit chain; erasure privileged).
--
-- ## Lifecycle (BR-095: Draft → Approved → Retired)
--
-- - Create: item (draft) + version 1 (draft). Nothing is served until approval:
--   the serving query reads `live_version_id`, which is NULL.
-- - Edit of a draft item: new version row (draft), item pointer untouched.
-- - Edit of an APPROVED item: new version row (draft); the approved version STAYS
--   LIVE until the new one is approved (P09.01.02) — the item's live pointer moves
--   only on approval, atomically with the approval row, under the item lock.
-- - Approve: guarded UPDATE (state = draft acquired from the live check) + live pointer
--   move + approval row, one transaction. Concurrent approves serialise on the item
--   row lock; the loser finds no draft and 409s.
-- - Retire: guarded UPDATE to retired; the live pointer is CLEARED — retired items are
--   never served (P09.01.04). Retirement is terminal: no transition out.
--
-- ## Metadata (BR-095)
--
-- Per-version content (title, body) plus per-version metadata: source
-- (website|pdf|manual|import), location id (nullable: global card), category,
-- valid_from/valid_until, sensitivity (public|internal|restricted), allowed_channels
-- (call|message|all as a CHECKed array). Approval audit (by/at) lives on the approval
-- row; last_verified_at is bumped by re-verification (P09.05 owns the sweep).
-- Bodies NEVER reach audit rows (INV-12): audit carries title + version markers only.
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML
-- (versions: no UPDATE/DELETE; approvals: no UPDATE/DELETE).

CREATE TABLE knowledge_items (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  -- Lifecycle state of the ITEM (the shell): draft until first approval, approved
  -- while a live version exists, retired terminally (live pointer cleared).
  state           text        NOT NULL DEFAULT 'draft'
                    CHECK (state IN ('draft', 'approved', 'retired')),
  -- Current live version (NULL until first approval, NULL after retirement).
  -- Loose reference, no FK: versions are immutable and never deleted, but the pointer
  -- must clear on retire while the version row lives on as history.
  live_version_id uuid,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CHECK (state <> 'approved' OR live_version_id IS NOT NULL),
  CHECK (state <> 'retired' OR live_version_id IS NULL)
);

CREATE TABLE knowledge_versions (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  item_id         uuid        NOT NULL,
  -- Monotonic per item (1, 2, 3…): the human-visible version (BR-095 "version").
  version_no      integer     NOT NULL CHECK (version_no > 0),
  title           text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body            text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 8000),
  -- Draft content until its approval row lands; approved rows are history.
  state           text        NOT NULL DEFAULT 'draft'
                    CHECK (state IN ('draft', 'approved')),
  source          text        NOT NULL
                    CHECK (source IN ('website', 'pdf', 'manual', 'import')),
  location_id     uuid,
  category        text        NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  valid_from      date,
  valid_until     date,
  sensitivity     text        NOT NULL DEFAULT 'public'
                    CHECK (sensitivity IN ('public', 'internal', 'restricted')),
  allowed_channels text[]     NOT NULL DEFAULT '{call,message}'
                    CHECK (allowed_channels <@ '{call,message}' AND allowed_channels <> '{}'),
  last_verified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, item_id, version_no),
  FOREIGN KEY (organisation_id, item_id) REFERENCES knowledge_items (organisation_id, id) ON DELETE CASCADE,
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until)
);

CREATE INDEX knowledge_versions_item_idx ON knowledge_versions (organisation_id, item_id);

CREATE TABLE knowledge_approvals (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  item_id         uuid        NOT NULL,
  version_id      uuid        NOT NULL,
  approved_by     uuid        NOT NULL,
  approved_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- One approval per version: re-approving the same version is a no-op refused at
  -- the service layer (the item lock serialises it into a 409).
  UNIQUE (organisation_id, version_id),
  FOREIGN KEY (organisation_id, item_id) REFERENCES knowledge_items (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, version_id) REFERENCES knowledge_versions (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX knowledge_approvals_item_idx ON knowledge_approvals (organisation_id, item_id);

COMMENT ON TABLE knowledge_items IS 'Knowledge card shells (P09.01, BR-095). Mutable state + live-version pointer; content lives in knowledge_versions.';
COMMENT ON COLUMN knowledge_items.live_version_id IS 'Currently served version (NULL until first approval, NULL after retirement). Moved only on approval/retire under the item lock.';
COMMENT ON TABLE knowledge_versions IS 'Immutable knowledge history (P09.01, BR-095). Append-only: moin_app holds SELECT + INSERT, never UPDATE/DELETE (fact_schemas precedent, 0044).';
COMMENT ON COLUMN knowledge_versions.body IS 'Approved card text, spoken verbatim (ADR-0014). NEVER reaches audit rows (INV-12).';
COMMENT ON TABLE knowledge_approvals IS 'Who approved which version when (P09.01, BR-095). Append-only ledger; erasure runs privileged.';

SELECT app.apply_tenant_rls('knowledge_items');
SELECT app.apply_tenant_rls('knowledge_versions');
SELECT app.apply_tenant_rls('knowledge_approvals');

REVOKE ALL ON TABLE knowledge_items, knowledge_versions, knowledge_approvals
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON knowledge_items TO moin_app;
-- Versions: the draft→approved flip is the single permitted write (guarded UPDATE with
-- a state='draft' WHERE clause — an approved row never matches again, so history is
-- still append-only in effect). No DELETE ever. Approvals append-only.
GRANT SELECT, INSERT, UPDATE ON knowledge_versions TO moin_app;
GRANT SELECT, INSERT ON knowledge_approvals TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only — never bodies.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.create', 'version_no', 'count', 'created version number; no title or body'),
  ('knowledge.edit', 'version_no', 'count', 'new draft version number; no title or body'),
  ('knowledge.approve', 'version_no', 'count', 'approved version number; approver is the actor, never content'),
  ('knowledge.retire', 'scope', 'count', 'always 1 (item retired); no title or body')
ON CONFLICT (operation, argument_key) DO NOTHING;
