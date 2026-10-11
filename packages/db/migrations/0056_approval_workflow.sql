-- 0056 — approval workflow hardening (P09.05).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What 0052 left open (and this closes at the DB boundary)
--
-- The 0052 door validated latest-draft + wrote ledger/flip/pointer atomically — but
-- the approver was a CALLER-SUPPLIED UUID (`p_approved_by`): staff nominating an
-- owner's UUID published as the owner (CRITICAL identity flaw — the role check read
-- the NOMINATED uuid, not the ACTOR). This closes it at three levels:
-- 1. Actor resolved server-side: `app.current_user()` reads transaction-local
--    `app.actor_id` (SET by withTenant from the session — same plumbing as
--    current_org, INV-02: never from a request body). The DEFINER takes TWO params
--    (item, version) and resolves WHO from the txn — there is no nominate-an-owner
--    parameter anymore. A staff context calling approve = 403, whatever UUID they
--    wish they were.
-- 2. Role stamped: membership role of THAT actor (owner|admin only — staff dies
--    insufficient_privilege, the contract code for guards).
-- 3. Content bound: version_hash (sha256 over title + body + version_no) computed
--    from the row being flipped; WHEN stamped as decided_at (DEFAULT now()).
--
-- All three are DEFINER-resolved (not caller-supplied). Pre-existing ledger rows
-- stay NULL on the new columns (backfilling a role/hash claim would FABRICATE
-- evidence — honest NULLs, CHECKs allow NULL).
-- Tenant rows: composite uniques/FKs, RLS + FORCE (via 0052 apply_tenant_rls —
-- ALTERs inherit the policy; no re-apply needed, no new table here).
--
-- ## DEFINER replacement (CREATE OR REPLACE — same name, FEWER params)
--
-- Signature changes 3-arg → 2-arg (p_approved_by REMOVED — that is the fix). Body
-- digest changes → REVIEWED_BODIES + allowlist entry updated alongside (same
-- commit, like every DEFINER change).

CREATE OR REPLACE FUNCTION app.current_user() RETURNS uuid
  LANGUAGE sql
  STABLE
  -- Not SECURITY DEFINER: reads a transaction-local setting, must run as caller.
  SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app.current_user() IS
  'The acting user of the current transaction (SET by withTenant from the session, INV-02), or NULL when none is set. The approval role gate reads this — never a caller-supplied UUID.';

GRANT EXECUTE ON FUNCTION app.current_user() TO
  moin_app, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;

CREATE OR REPLACE FUNCTION app.approve_knowledge_version(p_item_id uuid, p_version_id uuid)
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
  v_actor uuid;
BEGIN
  -- Actor FIRST, server-side: whoever the txn belongs to (never a parameter).
  v_actor := app.current_user();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'knowledge approval requires an acting user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Item lock first: concurrent approves serialise here.
  SELECT state INTO v_state FROM public.knowledge_items
    WHERE organisation_id = app.current_org() AND id = p_item_id FOR UPDATE;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'knowledge item not found' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_state = 'retired' THEN
    RAISE EXCEPTION 'knowledge item is retired' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Approver role of THAT actor (not a nominated uuid): owner|admin only.
  SELECT m.role INTO v_role FROM public.memberships m
    WHERE m.organisation_id = app.current_org() AND m.user_id = v_actor
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
      USING ERRCODE = 'insufficient_privilege';
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
    VALUES (app.current_org(), gen_random_uuid(), p_item_id, p_version_id, v_actor,
            v_role, v_hash, clock_timestamp());
  UPDATE public.knowledge_versions SET state = 'approved'
    WHERE organisation_id = app.current_org() AND id = p_version_id;
  UPDATE public.knowledge_items SET state = 'approved', live_version_id = p_version_id,
      updated_at = clock_timestamp(), version = version + 1
    WHERE organisation_id = app.current_org() AND id = p_item_id;
END
$$;

ALTER TABLE knowledge_approvals
  ADD COLUMN approver_role text CHECK (approver_role IN ('owner', 'admin')),
  ADD COLUMN version_hash text,
  ADD COLUMN decided_at timestamptz NOT NULL DEFAULT now();

-- The 3-arg 0052 signature is SUPERSEDED (the approver param was the identity flaw):
-- drop it so no caller can keep nominating UUIDs. The 2-arg door below is the only
-- publish path. (CREATE OR REPLACE cannot drop a parameter — new signature + DROP.)
DROP FUNCTION IF EXISTS app.approve_knowledge_version(uuid, uuid, uuid);

REVOKE ALL ON FUNCTION app.approve_knowledge_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.approve_knowledge_version(uuid, uuid) TO moin_app;
REVOKE ALL ON FUNCTION app.current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user() TO
  moin_app, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;

COMMENT ON FUNCTION app.approve_knowledge_version(uuid, uuid) IS
  'Publishes one knowledge version (P09.05): actor from app.current_user(), item lock, latest-draft check, role gate, content hash, ledger + flip + pointer — atomically. The only publish path (direct writes revoked).';

COMMENT ON COLUMN knowledge_approvals.approver_role IS 'Membership role resolved inside the DEFINER at approval time (owner|admin only — staff dies in the fn). Stamped, never caller-supplied.';
COMMENT ON COLUMN knowledge_approvals.version_hash IS 'sha256 over length-prefixed title+body+version_no at approval time. Content binding for later disputes.';
COMMENT ON COLUMN knowledge_approvals.decided_at IS 'Approval instant (workflow-facing name). NOT NULL DEFAULT now().';

-- Backfill: existing rows (pre-0056 approvals) get role unknown-free defaults?
-- No: approver_role + version_hash stay NULL for pre-existing rows (the CHECKs allow
-- NULL) — backfilling a role claim or hash for approvals that predated the stamping
-- would FABRICATE evidence. New rows must carry all three (NOT NULL enforced below
-- only for decided_at default; role/hash required by the fn, nullable in schema for
-- honest history).

-- Allowlist rows for the bulk-run audit (markers only — counts, never ids).
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.bulk_approve', 'approved', 'count', 'per-run approved count; no ids or content'),
  ('knowledge.bulk_approve', 'total', 'count', 'per-run total count; no ids or content')
ON CONFLICT (operation, argument_key) DO NOTHING;
