-- 0056 — approval workflow hardening (P09.05).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What 0052 left open (and this closes at the DB boundary)
--
-- The 0052 door took a CALLER-SUPPLIED approver UUID (`p_approved_by`) and checked
-- the role of the NOMINATED user: staff nominating an owner's UUID published as the
-- owner. This closes it:
-- 1. Actor bound at the service boundary: `approveKnowledgeVersion` reads the actor
--    from the TenantClient context (`currentTenant().actorId` — SET by withTenant
--    from the session, INV-02: never from a request body) and passes it as the
--    fn's `p_actor` argument. There is NO approvedBy service param — nominating
--    another user's UUID is inexpressible above the service. A staff context
--    calling approve = 403, whatever UUID they wish they were.
-- 2. Role stamped: membership role of THAT actor (owner|admin only — staff dies
--    insufficient_privilege, 42501, the contract code for authz guards).
-- 3. Content bound: version_hash (sha256 over title + body + version_no) computed
--    from the row being flipped; WHEN stamped as decided_at.
-- Trust model (house precedent: accept_invitation p_actor_id, 0018): the fn trusts
-- its caller the way every DEFINER does — moin_app holds EXECUTE and can always
-- call SQL directly. The guarantee sits one layer up: the service is the only
-- caller, and the service binds actor from session context, never caller input.
-- Tenant rows: composite uniques/FKs, RLS + FORCE (via 0052 apply_tenant_rls —
-- ALTERs inherit the policy; no re-apply needed, no new table here).
--
-- ## SQLSTATE contract
--
-- Role failures → 42501 insufficient_privilege (service maps to 403). Content
-- failures (missing item, retired, stale/non-draft version) → 22023
-- invalid_parameter_value (service maps to 409). One code per failure class —
-- never share the guard code across the authz/content boundary again.

-- 0052 created the 3-arg door (item, version, approver). 0056 keeps three args
-- but RENAMES the third (p_approved_by → p_actor: service-bound, from session
-- context, never caller input above the service — see header). Postgres forbids
-- renaming an input parameter via CREATE OR REPLACE (42P13), so DROP first —
-- safe here: 0056 is unmerged (never applied outside this branch's test runs),
-- and the template rebuilds from scratch every integration run.
DROP FUNCTION IF EXISTS app.approve_knowledge_version(uuid, uuid, uuid);

CREATE FUNCTION app.approve_knowledge_version(
  p_item_id uuid, p_version_id uuid, p_actor uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_state text;
  v_latest boolean;
  v_no integer;
  v_role text;
  v_hash text;
  v_title text;
  v_body text;
BEGIN
  -- Actor FIRST, service-bound (never caller input above the service). Missing
  -- actor is a caller bug, not an authz decision — 22023, not 42501.
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'knowledge approval requires an acting user' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Item lock first: concurrent approves serialise here.
  SELECT state INTO v_state FROM public.knowledge_items
    WHERE organisation_id = app.current_org() AND id = p_item_id FOR UPDATE;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'knowledge item not found' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_state = 'retired' THEN
    RAISE EXCEPTION 'knowledge item is retired' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Approver role of THAT actor (not a nominated uuid): owner|admin only. The
  -- only 42501 in this fn — the authz boundary.
  SELECT m.role INTO v_role FROM public.memberships m
    WHERE m.organisation_id = app.current_org() AND m.user_id = p_actor
      AND m.status = 'active';
  IF v_role IS NULL OR (v_role <> 'owner' AND v_role <> 'admin') THEN
    RAISE EXCEPTION 'knowledge approval requires owner or admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Latest-draft check: stale drafts never go live (P09.05.03). IS NOT TRUE
  -- covers BOTH missing rows (NULL: wrong pair) and stale drafts (false: superseded).
  SELECT state = 'draft'
     AND version_no = (SELECT max(version_no) FROM public.knowledge_versions
                       WHERE organisation_id = app.current_org() AND item_id = p_item_id),
         version_no, title, body
    INTO v_latest, v_no, v_title, v_body FROM public.knowledge_versions
    WHERE organisation_id = app.current_org() AND id = p_version_id AND item_id = p_item_id;
  IF v_latest IS NOT TRUE THEN
    RAISE EXCEPTION 'knowledge version is not the latest approvable draft'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Content binding: sha256 over the payload being approved (audit-chain digest()
  -- precedent, 0008 — pgcrypto, deterministic, no key). Length-prefixed fields
  -- (len:title:len:body:len:no): chr(31) separators are NOT rejected by title/body
  -- CHECKs, so a separator byte inside content could forge a colliding preimage —
  -- lengths make the encoding unambiguous whatever the content holds.
  v_hash := encode(
    digest(convert_to(char_length(v_title)::text || ':' || v_title
                       || char_length(v_body)::text || ':' || v_body
                       || char_length(v_no::text)::text || ':' || v_no::text, 'UTF8'), 'sha256'),
    'hex');
  -- Ledger, flip, pointer — atomically, as owner. Actor + role + hash + time STAMPED.
  INSERT INTO public.knowledge_approvals
    (organisation_id, id, item_id, version_id, approved_by, approver_role, version_hash, decided_at)
    VALUES (app.current_org(), gen_random_uuid(), p_item_id, p_version_id, p_actor,
            v_role, v_hash, clock_timestamp());
  UPDATE public.knowledge_versions SET state = 'approved'
    WHERE organisation_id = app.current_org() AND id = p_version_id;
  UPDATE public.knowledge_items SET state = 'approved', live_version_id = p_version_id,
      updated_at = clock_timestamp(), version = version + 1
    WHERE organisation_id = app.current_org() AND id = p_item_id;
END
$$;

-- decided_at in three steps (HIGH-1: DEFAULT now() on ADD would stamp the
-- migration instant onto rows whose real decision time is approved_at):
-- 1. nullable column, 2. backfill from approved_at (pre-existing rows keep
-- their TRUE decision time — no fabricated history), 3. NOT NULL + DEFAULT
-- for future inserts.
ALTER TABLE knowledge_approvals
  ADD COLUMN approver_role text CHECK (approver_role IN ('owner', 'admin')),
  ADD COLUMN version_hash text,
  ADD COLUMN decided_at timestamptz;

-- RLS is FORCE (0004): the policy hides tenant rows from EVERY role including
-- the migrator (app.current_org() is unset here), so a plain UPDATE touches
-- zero rows whenever pre-existing approvals exist — the silent-no-op trap 0010
-- documents. Same precedent: lift FORCE for the backfill, verify, restore.
-- Single-transaction migration: a failure anywhere rolls everything back, and
-- the catalog check fails any tenant table left un-FORCEd.
ALTER TABLE knowledge_approvals NO FORCE ROW LEVEL SECURITY;
UPDATE knowledge_approvals SET decided_at = approved_at WHERE decided_at IS NULL;
DO $$
DECLARE
  v_unfilled bigint;
BEGIN
  SELECT count(*) INTO v_unfilled FROM knowledge_approvals WHERE decided_at IS NULL;
  IF v_unfilled > 0 THEN
    RAISE EXCEPTION 'decided_at backfill left % row(s) unfilled', v_unfilled;
  END IF;
END
$$;
ALTER TABLE knowledge_approvals FORCE ROW LEVEL SECURITY;

ALTER TABLE knowledge_approvals
  ALTER COLUMN decided_at SET NOT NULL,
  ALTER COLUMN decided_at SET DEFAULT now();

REVOKE ALL ON FUNCTION app.approve_knowledge_version(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.approve_knowledge_version(uuid, uuid, uuid) TO moin_app;

COMMENT ON FUNCTION app.approve_knowledge_version(uuid, uuid, uuid) IS
  'Publishes one knowledge version (P09.05): service-bound actor (p_actor from session context, never caller input), item lock, latest-draft check, role gate, content hash, ledger + flip + pointer — atomically. The only publish path (direct writes revoked). Role failures raise 42501 (403); content failures raise 22023 (409).';

COMMENT ON COLUMN knowledge_approvals.approver_role IS 'Membership role resolved inside the DEFINER at approval time (owner|admin only — staff dies in the fn). Stamped, never caller-supplied.';
COMMENT ON COLUMN knowledge_approvals.version_hash IS 'sha256 over length-prefixed title+body+version_no at approval time. Content binding for later disputes.';
COMMENT ON COLUMN knowledge_approvals.decided_at IS 'Approval instant (workflow-facing name). Backfilled from approved_at for pre-0056 rows; NOT NULL DEFAULT now() for new rows.';

-- Backfill honesty: approver_role + version_hash stay NULL for pre-existing rows
-- (the CHECKs allow NULL) — backfilling a role claim or hash for approvals that
-- predated the stamping would FABRICATE evidence. decided_at is the exception:
-- approved_at already records the true decision instant, so copying it preserves
-- history instead of falsifying it.

-- Allowlist rows for the bulk-run audit (markers only — counts, never ids).
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.bulk_approve', 'approved', 'count', 'per-run approved count; no ids or content'),
  ('knowledge.bulk_approve', 'total', 'count', 'per-run total count; no ids or content')
ON CONFLICT (operation, argument_key) DO NOTHING;
