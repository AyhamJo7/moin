-- migration-check: allow truncate because the only TRUNCATE here is inside a BEFORE TRUNCATE guard that rejects it; no data is destroyed.
-- 0010 — the tenant register the daily chain verifier walks (P06.10.05, INV-10).
--
-- ## Why this table has to exist
--
-- Verification runs across every tenant by definition: the break that matters most is in a chain
-- no request touched today, so something has to produce the list. `organisations` cannot: it is a
-- tenant table under FORCE ROW LEVEL SECURITY, and FORCE means the policy applies to the table's
-- owner too. Measured against real PostgreSQL rather than assumed — with no tenant set,
-- `moin_migrator` (which owns the table) counts **zero** organisations, and a `SECURITY DEFINER`
-- function owned by it returns **zero** rows for the same reason. There is no role that may
-- enumerate tenants, and adding one would mean `BYPASSRLS`, which INV-01 forbids outright.
--
-- So the tenant list for cross-tenant bookkeeping is a global register, exactly as
-- `docs/architecture/global-tables.md` rule 3 describes: a tenant-resolution mechanism cannot
-- itself be tenant-scoped without circularity. It holds one opaque identifier per tenant and no
-- customer data at all.
--
-- ## Why a trigger fills it rather than the provisioning function
--
-- `provision_tenant` is not the only way a row reaches `organisations` — a migration or a repair
-- script can insert one, and those are precisely the paths where somebody forgets a bookkeeping
-- step. A trigger on the table itself cannot be forgotten: whatever inserts an organisation
-- registers its chain in the same statement, or the insert fails.
--
-- ## Why the register is append-only
--
-- A register a privileged actor can delete from is a register that makes "remove the row" the
-- cheapest way to hide a tampered chain — the verifier would simply never look at that tenant and
-- would report a clean run. Deleting or rewriting a registration is therefore rejected by a
-- trigger, for the table's owner as well, on the same reasoning as `audit_events` itself.
-- Registration is a fact about a tenant having existed, and a tenant that existed keeps its
-- history: ADR-0017 records that the append-only trigger has no erasure exception yet, and
-- ADR-0018 owns the retention decision.

CREATE TABLE audit_chain_registry (
  tenant_id uuid NOT NULL PRIMARY KEY REFERENCES organisations(id),
  registered_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE audit_chain_registry IS
  'Global: one opaque tenant identifier per audit chain the daily verifier must walk. No customer data.';
-- Default privileges grant moin_app DML on new tables in `public`; a register it could write is a
-- register it could empty, so the grant is taken back explicitly rather than left to the default.
REVOKE ALL ON audit_chain_registry FROM moin_app, moin_provisioner;

CREATE FUNCTION app.reject_registry_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
AS $$ BEGIN
  RAISE EXCEPTION 'audit chain registrations are append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION app.reject_registry_mutation() FROM PUBLIC;

-- `ENABLE ALWAYS` and a separate `TRUNCATE` guard, for the reasons 0008 sets out: a guard that
-- `session_replication_role = 'replica'` switches off is not a guard, and `TRUNCATE` is a third
-- row-removing verb that neither `BEFORE UPDATE` nor `BEFORE DELETE` sees. Emptying this table is
-- precisely the attack the append-only rule exists to stop — every tenant would leave the worklist
-- at once and the next sweep would report a clean run over nobody.
CREATE TRIGGER audit_chain_registry_append_only BEFORE UPDATE OR DELETE ON audit_chain_registry
  FOR EACH ROW EXECUTE FUNCTION app.reject_registry_mutation();
ALTER TABLE audit_chain_registry ENABLE ALWAYS TRIGGER audit_chain_registry_append_only;
CREATE TRIGGER audit_chain_registry_no_truncate BEFORE TRUNCATE ON audit_chain_registry
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_registry_mutation();
ALTER TABLE audit_chain_registry ENABLE ALWAYS TRIGGER audit_chain_registry_no_truncate;

-- Registration rides along with the insert that creates the tenant. Not SECURITY DEFINER: every
-- path that may insert an organisation (the provisioning definer, a migration) already owns or is
-- granted this table, and an elevated trigger here would be a privilege nobody needs.
CREATE FUNCTION app.register_audit_chain() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, app, pg_temp
AS $$
BEGIN
  INSERT INTO audit_chain_registry(tenant_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.register_audit_chain() FROM PUBLIC;
CREATE TRIGGER organisations_register_audit_chain AFTER INSERT ON organisations
  FOR EACH ROW EXECUTE FUNCTION app.register_audit_chain();
ALTER TABLE organisations ENABLE ALWAYS TRIGGER organisations_register_audit_chain;

-- ---------------------------------------------------------------------------------------------
-- Backfill: the trigger only sees inserts that come after it.
-- ---------------------------------------------------------------------------------------------
--
-- Every organisation that already exists when this migration lands would otherwise be absent from
-- the register **permanently** — and because the register is append-only and `organisations` cannot
-- be enumerated by any non-superuser role, no later repair script could add it. The window to get
-- this right closes when the migration is first applied.
--
-- The obvious backfill is also the trap: `INSERT … SELECT id FROM organisations` inserts **zero
-- rows and raises nothing**, because FORCE ROW LEVEL SECURITY applies to the migrator that owns the
-- table and `app.current_org()` is NULL here — a silent no-op that looks like success. So FORCE is
-- lifted for the length of this transaction, which is the one place it is legitimate: the migration
-- runs in a single transaction as the table's owner, the setting is restored below, and a failure
-- anywhere in between rolls the whole thing back. The catalog check independently fails on any
-- tenant table that is not FORCEd, so a migration that forgets to restore it cannot reach `main`.
ALTER TABLE organisations NO FORCE ROW LEVEL SECURITY;
INSERT INTO audit_chain_registry(tenant_id) SELECT id FROM organisations ON CONFLICT DO NOTHING;
DO $$
DECLARE
  organisation_count bigint;
  registered_count bigint;
BEGIN
  SELECT count(*) INTO organisation_count FROM organisations;
  SELECT count(*) INTO registered_count FROM audit_chain_registry;
  IF organisation_count <> registered_count THEN
    RAISE EXCEPTION
      'audit chain register backfill covered % of % organisation(s). Every tenant must be registered before the daily verifier can claim full coverage (INV-10).',
      registered_count, organisation_count;
  END IF;
END
$$;
ALTER TABLE organisations FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------------------------
-- The claim function the verifier's `withSystemWork` sweep calls.
-- ---------------------------------------------------------------------------------------------
--
-- Identifiers only, one page at a time, and the caller re-reads each chain inside `withTenant` as
-- the ordinary application role — the reviewed shape `docs/architecture/security-definer-allowlist.md`
-- pre-registers for claim functions (P06.14.01). It is elevated because `moin_app` has no grant on
-- the register: constraining the runtime role to a paged list of identifiers is narrower than
-- letting it select the table and join against it.
--
-- Paging is by key rather than `OFFSET`, which would re-scan and could shift rows between pages so
-- that an existing tenant is skipped. Note what this does *not* promise: identifiers are random
-- UUIDs, so a tenant registered while a sweep is in flight sorts before the cursor about half the
-- time and is then picked up by the next run rather than this one. That is acceptable — its chain is
-- at most one event old — and it is stated here rather than implied, because the reconciliation
-- function below is what actually guarantees no tenant is missed indefinitely.

CREATE FUNCTION app.claim_audit_chains(p_limit integer, p_after uuid)
  RETURNS TABLE (organisation_id uuid, id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT r.tenant_id AS organisation_id, r.tenant_id AS id
  FROM audit_chain_registry r
  WHERE p_after IS NULL OR r.tenant_id > p_after
  ORDER BY r.tenant_id
  LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000)
$$;
REVOKE ALL ON FUNCTION app.claim_audit_chains(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_audit_chains(integer, uuid) TO moin_app;
COMMENT ON FUNCTION app.claim_audit_chains(integer, uuid)
  IS 'QG-09: identifiers only — one page of tenants whose audit chain the daily verifier must check.';

-- ---------------------------------------------------------------------------------------------
-- Reconciliation: is the register itself complete?
-- ---------------------------------------------------------------------------------------------
--
-- The sweep treats the register as its worklist, so on its own it cannot tell a clean estate from a
-- register that is missing tenants. The registration trigger can be disabled and re-enabled around
-- an insert, leaving nothing in the catalog to find afterwards, and that gap would otherwise read as
-- a clean run forever.
--
-- `provisioning_requests` is the independent witness: it is global, deliberately outside RLS so that
-- retries can be made idempotent before tenant context exists (`0007`), and every tenant the
-- application can create leaves an accepted row in it. Comparing it with the register turns a
-- missing registration into a finding instead of silence. Identifiers only, as ever.
CREATE FUNCTION app.unregistered_audit_chains(p_limit integer)
  RETURNS TABLE (organisation_id uuid, id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT r.tenant_id AS organisation_id, r.tenant_id AS id
  FROM provisioning_requests r
  WHERE r.tenant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM audit_chain_registry c WHERE c.tenant_id = r.tenant_id
    )
  GROUP BY r.tenant_id
  ORDER BY r.tenant_id
  LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000)
$$;
REVOKE ALL ON FUNCTION app.unregistered_audit_chains(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.unregistered_audit_chains(integer) TO moin_app;
COMMENT ON FUNCTION app.unregistered_audit_chains(integer)
  IS 'QG-09: identifiers only — provisioned tenants whose audit chain is missing from the register.';
