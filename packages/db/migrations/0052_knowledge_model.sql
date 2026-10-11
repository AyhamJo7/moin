-- 0052 — knowledge model, lifecycle and versions (P09.01).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## Shape: item (mutable shell) + versions (guarded history) + approvals (ledger)
--
-- `knowledge_items` is the mutable shell: one row per card/FAQ, carrying the CURRENT
-- live version pointer (`live_version_id`, NULL until first approval) and the lifecycle
-- state (draft | approved | retired). `knowledge_versions` is history with exactly one
-- permitted write: the draft→approved flip on approval. That single write is enforced
-- at TWO boundaries: the service issues a guarded UPDATE (state='draft' in WHERE), and
-- the `knowledge_versions_lifecycle` trigger below rejects every other UPDATE shape at
-- the DB boundary (a hand-written UPDATE of an approved body, a state regression, or a
-- field edit on a live row all raise — the service can never be bypassed by a future
-- caller that forgets the guard). `knowledge_approvals` records who approved which
-- version when (append-only like the audit chain; erasure privileged).
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
-- (versions: guarded flip only — trigger-enforced; approvals: no UPDATE/DELETE).

CREATE TABLE knowledge_items (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  -- Lifecycle state of the ITEM (the shell): draft until first approval, approved
  -- while a live version exists, retired terminally (live pointer cleared).
  state           text        NOT NULL DEFAULT 'draft'
                    CHECK (state IN ('draft', 'approved', 'retired')),
  -- Current live version (NULL until first approval, NULL after retirement).
  -- Loose reference, no FK: versions are never deleted, but the pointer must clear
  -- on retire while the version row lives on as history. The items trigger below
  -- constrains pointer moves to approved versions (or NULL on retire).
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
  -- Item-scoped identity: a version belongs to exactly one (org, item). The approvals
  -- FK below targets (org, item, id) so an approval can never name an item/version
  -- pair that do not belong together — the mismatch dies as 23503, not as a 409.
  UNIQUE (organisation_id, item_id, id),
  FOREIGN KEY (organisation_id, item_id) REFERENCES knowledge_items (organisation_id, id) ON DELETE CASCADE,
  -- Nullable composite leg to locations (global card when NULL): same-tenant only —
  -- a cross-tenant location id dies as 23503. RESTRICT on delete (not SET NULL): the
  -- versions trigger freezes location_id (FK actions fire the row trigger too,
  -- probe-verified), so SET NULL would be dead text — RESTRICT refuses honestly, and
  -- locations with knowledge legs are disassociated first, never silently unlinked.
  FOREIGN KEY (organisation_id, location_id) REFERENCES locations (organisation_id, id) ON DELETE RESTRICT,
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
  -- Item-scoped: the version must belong to the named item (see versions unique above).
  FOREIGN KEY (organisation_id, item_id, version_id) REFERENCES knowledge_versions (organisation_id, item_id, id) ON DELETE CASCADE
);

CREATE INDEX knowledge_approvals_item_idx ON knowledge_approvals (organisation_id, item_id);

-- ## The approve path is a single DEFINER door (finding: fabricated-approval flip)
--
-- Ledger-first ordering closed the service path but NOT direct SQL: moin_app could
-- INSERT a fabricated approval row, then UPDATE the version (the EXISTS check
-- passes — the row exists, just not from the service). Triggers cannot tell who
-- wrote the approval row. So publishing goes through ONE door:
-- `app.approve_knowledge_version(p_item, p_version, p_approver)` (SECURITY DEFINER,
-- allowlisted + digest-pinned like delete_orphan_conversation):
--   1. locks the item row (serialises concurrent approves),
--   2. refuses retired items and non-latest/non-draft versions (409s as exceptions),
--   3. inserts the approval row, flips the version, moves the live pointer —
--      atomically, as the table owner (FORCE RLS still applies to the owner? No:
--      the owner is NOBYPASSRLS-exempt? The function constrains every write to
--      app.current_org(), so cross-tenant approval is inexpressible).
-- moin_app holds NO direct write to the publish path: REVOKE UPDATE on
-- knowledge_versions (the flip lives inside the fn), REVOKE INSERT on
-- knowledge_approvals (the ledger row lives inside the fn). Direct INSERT of an
-- approved version, direct approval INSERT, direct flip, direct pointer move that
-- violates lifecycle — all 42501/trigger-raises. The service calls the fn, then
-- audits (markers only) in the same txn.
--
-- Why not ALSO revoke UPDATE on knowledge_items: retire + the live-pointer move need
-- direct writes (they are not publication — retire unpublishes). The items lifecycle
-- trigger guards those shapes instead (forward-only + approved-or-NULL-on-retire).

CREATE FUNCTION app.approve_knowledge_version(p_item_id uuid, p_version_id uuid, p_approved_by uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_state text;
  v_latest boolean;
  v_no integer;
BEGIN
  -- Item lock first: concurrent approves serialise here.
  SELECT state INTO v_state FROM public.knowledge_items
    WHERE organisation_id = app.current_org() AND id = p_item_id FOR UPDATE;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'knowledge item not found' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_state = 'retired' THEN
    RAISE EXCEPTION 'knowledge item is retired' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Latest-draft check: stale drafts never go live (P09.05.03).
  SELECT state = 'draft'
     AND version_no = (SELECT max(version_no) FROM public.knowledge_versions
                       WHERE organisation_id = app.current_org() AND item_id = p_item_id),
         version_no
    INTO v_state, v_no FROM public.knowledge_versions
    WHERE organisation_id = app.current_org() AND id = p_version_id AND item_id = p_item_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'knowledge version is not the latest approvable draft'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Ledger, flip, pointer — atomically, as owner.
  INSERT INTO public.knowledge_approvals (organisation_id, id, item_id, version_id, approved_by)
    VALUES (app.current_org(), gen_random_uuid(), p_item_id, p_version_id, p_approved_by);
  UPDATE public.knowledge_versions SET state = 'approved'
    WHERE organisation_id = app.current_org() AND id = p_version_id;
  UPDATE public.knowledge_items SET state = 'approved', live_version_id = p_version_id,
      updated_at = clock_timestamp(), version = version + 1
    WHERE organisation_id = app.current_org() AND id = p_item_id;
END
$$;

REVOKE ALL ON FUNCTION app.approve_knowledge_version(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.approve_knowledge_version(uuid, uuid, uuid) TO moin_app;

COMMENT ON FUNCTION app.approve_knowledge_version(uuid, uuid, uuid) IS
  'Publishes one knowledge version (P09.01): locks the item, requires the latest draft, inserts the approval row, flips the version, moves the live pointer — atomically. Tenant-scoped by app.current_org(); the only publish path (direct writes revoked).';

CREATE FUNCTION app.knowledge_versions_lifecycle() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ DECLARE
  has_approval boolean;
BEGIN
  -- The ONLY legal write: draft → approved, state column alone. Bodies, titles,
  -- metadata of an approved row are frozen; a draft row's content is written once at
  -- INSERT (edits create new versions, never UPDATE). Any other shape raises.
  IF OLD.state <> 'draft' OR NEW.state <> 'approved' THEN
    RAISE EXCEPTION 'knowledge versions allow only the draft-to-approved flip'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.category IS DISTINCT FROM OLD.category OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR NEW.sensitivity IS DISTINCT FROM OLD.sensitivity
     OR NEW.allowed_channels IS DISTINCT FROM OLD.allowed_channels
     OR NEW.last_verified_at IS DISTINCT FROM OLD.last_verified_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'knowledge versions allow only the draft-to-approved flip'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- location_id IS frozen like every other column: FK SET NULL actions fire the
  -- row trigger too (probe-verified: the FK NULL-ing raises through this guard), so
  -- deleting a location with version legs is REFUSED, not cascaded — locations with
  -- knowledge legs must be retired/disassociated first, never silently unlinked.
  -- (The 0041 column-list SET NULL precedent applies where no lifecycle trigger
  -- guards the child; here the guard wins deliberately.)
  -- The flip is the publication act: it requires the approval ledger row to EXIST
  -- (the service inserts it first, same txn, before flipping). A direct flip without
  -- the ledger — publishing without a named approver — raises. This is what makes the
  -- trigger stronger than the service guard alone: the guard checks draft+latest, the
  -- ledger check proves a human approved THIS version.
  SELECT EXISTS (
    SELECT 1 FROM public.knowledge_approvals a
    WHERE a.organisation_id = NEW.organisation_id AND a.version_id = NEW.id
  ) INTO has_approval;
  IF NOT has_approval THEN
    RAISE EXCEPTION 'knowledge version flip requires its approval ledger row'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app.knowledge_versions_lifecycle() FROM PUBLIC;

CREATE TRIGGER knowledge_versions_lifecycle BEFORE UPDATE ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION app.knowledge_versions_lifecycle();
ALTER TABLE knowledge_versions ENABLE ALWAYS TRIGGER knowledge_versions_lifecycle;

-- Versions INSERT guard: state must be draft on INSERT — smuggling an approved row
-- past the publish path (INSERT-approved-version) raises. (The flip trigger above
-- covers UPDATEs; this covers INSERTs.)
CREATE FUNCTION app.knowledge_versions_insert_draft() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ BEGIN
  IF NEW.state <> 'draft' THEN
    RAISE EXCEPTION 'knowledge versions are created as drafts; publishing goes through approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app.knowledge_versions_insert_draft() FROM PUBLIC;

CREATE TRIGGER knowledge_versions_insert_draft BEFORE INSERT ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION app.knowledge_versions_insert_draft();
ALTER TABLE knowledge_versions ENABLE ALWAYS TRIGGER knowledge_versions_insert_draft;

CREATE FUNCTION app.knowledge_items_lifecycle() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ DECLARE
  v_state text;
  v_item text;
BEGIN
  -- Item lifecycle: draft → approved → retired, forward only. approved → draft
  -- (quiet un-approval) and any exit from retired both raise.
  IF (OLD.state = 'approved' AND NEW.state = 'draft')
     OR (OLD.state = 'retired' AND NEW.state <> 'retired') THEN
    RAISE EXCEPTION 'knowledge item states move forward only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The live pointer may move only to an approved version of THIS item, or to NULL
  -- exactly when retiring. The item-match closes the cross-item pointer: a version
  -- of another item is approved yet belongs elsewhere, and still raises. Pointing at
  -- a draft raises.
  IF NEW.live_version_id IS DISTINCT FROM OLD.live_version_id THEN
    IF NEW.live_version_id IS NULL THEN
      IF NEW.state <> 'retired' THEN
        RAISE EXCEPTION 'knowledge live pointer clears only on retire'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSE
      SELECT v.state, v.item_id::text INTO v_state, v_item
        FROM public.knowledge_versions v
        WHERE v.organisation_id = NEW.organisation_id AND v.id = NEW.live_version_id;
      IF v_state IS NULL OR v_state <> 'approved' OR v_item IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'knowledge live pointer names an approved version of this item'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION app.knowledge_items_lifecycle() FROM PUBLIC;

CREATE TRIGGER knowledge_items_lifecycle BEFORE UPDATE ON knowledge_items
  FOR EACH ROW EXECUTE FUNCTION app.knowledge_items_lifecycle();
ALTER TABLE knowledge_items ENABLE ALWAYS TRIGGER knowledge_items_lifecycle;

COMMENT ON TABLE knowledge_items IS 'Knowledge card shells (P09.01, BR-095). Mutable state + live-version pointer; content lives in knowledge_versions.';
COMMENT ON COLUMN knowledge_items.live_version_id IS 'Currently served version (NULL until first approval, NULL after retirement). Moved only on approval/retire under the item lock.';
COMMENT ON TABLE knowledge_versions IS 'Knowledge history with one guarded write (P09.01, BR-095). Draft-to-approved flip only — trigger-enforced; never DELETE.';
COMMENT ON COLUMN knowledge_versions.body IS 'Approved card text, spoken verbatim (ADR-0014). NEVER reaches audit rows (INV-12).';
COMMENT ON TABLE knowledge_approvals IS 'Who approved which version when (P09.01, BR-095). Append-only ledger; erasure runs privileged.';

SELECT app.apply_tenant_rls('knowledge_items');
SELECT app.apply_tenant_rls('knowledge_versions');
SELECT app.apply_tenant_rls('knowledge_approvals');

REVOKE ALL ON TABLE knowledge_items, knowledge_versions, knowledge_approvals
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON knowledge_items TO moin_app;
-- Versions: NO direct UPDATE (the DEFINER fn flips as owner); INSERT guarded to drafts
-- by the insert trigger. No DELETE ever. Approvals: NO direct INSERT (the DEFINER fn
-- writes the ledger row); SELECT only.
GRANT SELECT, INSERT ON knowledge_versions TO moin_app;
GRANT SELECT ON knowledge_approvals TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only — never bodies.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.create', 'version_no', 'count', 'created version number; no title or body'),
  ('knowledge.edit', 'version_no', 'count', 'new draft version number; no title or body'),
  ('knowledge.approve', 'version_no', 'count', 'approved version number; approver is the actor, never content'),
  ('knowledge.retire', 'scope', 'count', 'always 1 (item retired); no title or body')
ON CONFLICT (operation, argument_key) DO NOTHING;
