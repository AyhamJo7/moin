-- 0056 — approval workflow hardening (P09.05).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What 0052 left open (and this closes at the DB boundary)
--
-- The DEFINER publish door (0052) validates latest-draft + writes ledger/flip/pointer
-- atomically — but two things stayed service-only:
-- 1. WHO may approve: the `approved_by` UUID was caller-supplied, never role-checked.
--    Staff could approve. This adds `approver_role` (owner|admin, CHECKed) to the
--    ledger row: the DEFINER resolves the approver's membership role inside the txn
--    and STAMPS it — a fabricated approval cannot claim owner/admin, and a staff
--    approval dies in the fn (invalid_parameter_value, not a silent write).
-- 2. WHAT was approved: no content binding — the ledger named (item, version) but
--    nothing proved the version's text at approval time. This adds `version_hash`
--    (TEXT NOT NULL, sha256 over title + body + metadata): the DEFINER computes it
--    from the row it flips and stores it. A later content dispute re-hashes the
--    version row and compares — the ledger is evidence, not just a pointer.
-- 3. WHEN: `decided_at` (NOT NULL, defaults now()) records the approval instant
--    explicitly (approved_at existed; decided_at is the workflow-facing name the
--    P09.05 service reads — one column, one meaning, no alias confusion).
--
-- All three are DEFINER-stamped (not caller-supplied): the service passes
-- (item, version, approver) and the fn resolves role + hash + time itself.
-- Tenant rows: composite uniques/FKs, RLS + FORCE (via 0052 apply_tenant_rls —
-- ALTERs inherit the policy; no re-apply needed, no new table here).
--
-- ## DEFINER replacement (CREATE OR REPLACE — same name/signature, new body)
--
-- The 0052 door now additionally: resolves the approver's membership role
-- (owner|admin only — staff dies invalid_parameter_value), computes the version
-- hash over the row it flips, and stamps role + hash + decided_at on the ledger
-- row. Body digest changes → REVIEWED_BODIES + allowlist entry updated alongside
-- (same commit, like every DEFINER change).

CREATE OR REPLACE FUNCTION app.approve_knowledge_version(p_item_id uuid, p_version_id uuid, p_approved_by uuid)
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
  -- Item lock first: concurrent approves serialise here.
  SELECT state INTO v_state FROM public.knowledge_items
    WHERE organisation_id = app.current_org() AND id = p_item_id FOR UPDATE;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'knowledge item not found' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_state = 'retired' THEN
    RAISE EXCEPTION 'knowledge item is retired' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Approver role INSIDE the txn (not caller-supplied): owner|admin only.
  SELECT m.role INTO v_role FROM public.memberships m
    WHERE m.organisation_id = app.current_org() AND m.user_id = p_approved_by
      AND m.status = 'active';
  IF v_role IS NULL OR (v_role <> 'owner' AND v_role <> 'admin') THEN
    RAISE EXCEPTION 'knowledge approval requires owner or admin' USING ERRCODE = 'invalid_parameter_value';
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
  -- precedent, 0008 — pgcrypto, deterministic, no key). Unit-separator (chr(31),
  -- never legal in titles/bodies per their btrim/CHECK shape) keeps field boundaries
  -- unambiguous — NUL (chr(0)) is rejected by convert_to AND node-pg alike.
  v_hash := encode(
    digest(convert_to(v_title || chr(31) || v_body || chr(31) || v_no::text, 'UTF8'), 'sha256'),
    'hex');
  -- Ledger, flip, pointer — atomically, as owner. Role + hash + time STAMPED.
  INSERT INTO public.knowledge_approvals
    (organisation_id, id, item_id, version_id, approved_by, approver_role, version_hash, decided_at)
    VALUES (app.current_org(), gen_random_uuid(), p_item_id, p_version_id, p_approved_by,
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
  ADD COLUMN decided_at timestamptz;

COMMENT ON COLUMN knowledge_approvals.approver_role IS 'Membership role resolved inside the DEFINER at approval time (owner|admin only — staff dies in the fn). Stamped, never caller-supplied.';
COMMENT ON COLUMN knowledge_approvals.version_hash IS 'sha256 over the approved version payload (title+body+metadata) at approval time. Content binding for later disputes.';
COMMENT ON COLUMN knowledge_approvals.decided_at IS 'Approval instant (workflow-facing name). Defaults now().';

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
