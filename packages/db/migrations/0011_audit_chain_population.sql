-- 0011 — a stable population snapshot for the audit sweep (P06.10.05, INV-10).
--
-- ## The defect this replaces
--
-- 0010 paged the register by `tenant_id`, a random UUID, and derived coverage from a count of rows
-- after the cursor. Measured, and the reason this migration exists:
--
--   register holds        bbbb…
--   the sweep claims      bbbb…            (cursor is now bbbb…)
--   concurrently register aaaa…            (a legitimate new tenant)
--   page after bbbb…      0 rows
--   count after bbbb…     0
--   unregistered check    0                (aaaa… *is* registered)
--
-- The sweep therefore reported complete coverage over one tenant while a second had been registered
-- and never verified. UUID order does not encode registration order, so no cursor over it can tell
-- "nothing left" from "something arrived behind me". Counting is no better: a late tenant ahead of
-- the cursor gets processed and pushes the processed count up to the original total while an
-- original member is still unvisited.
--
-- ## The fix: an immutable monotonic registration sequence, and a high-water mark
--
-- Each registration gets a `bigint` from a sequence, so registration order is recorded rather than
-- inferred. A sweep captures `max(registration_seq)` **once** at the start; its population is
-- exactly `registration_seq <= high_water`, and it pages `registration_seq > cursor` in that
-- order. Two properties follow, and they are the whole point:
--
--   * a tenant registered *before* the snapshot is in the population and must be verified or
--     counted as unreached, whatever its UUID happens to sort like;
--   * a tenant registered *after* the snapshot is not in this sweep's population at all — it
--     belongs to the next one, and cannot make this one look incomplete.
--
-- The guarantee is therefore "sound for the register population captured at sweep start", which is
-- both achievable and honest. Continuous-current soundness would need a lock or a snapshot held
-- across the whole sweep, and a long REPEATABLE READ transaction over every tenant's chain would
-- pin `xmin` for the duration on the fastest-growing table in the schema.
--
-- ## Why the column is immutable without a new guard
--
-- `audit_chain_registry_append_only` already rejects UPDATE and DELETE on this table for the owner
-- as well, and is `ENABLE ALWAYS`, so a registration's sequence cannot be rewritten once assigned.
-- The backfill below is the one exception, and it has to disable that trigger to run — which is
-- exactly why it happens here, inside one migration transaction, rather than being possible later.

-- ---------------------------------------------------------------------------------------------
-- 1. The column, nullable first so the add does not rewrite the table under an exclusive lock.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE audit_chain_registry ADD COLUMN registration_seq bigint;

COMMENT ON COLUMN audit_chain_registry.registration_seq IS
  'Monotonic registration order. Immutable after insert; a sweep''s population is seq <= its captured high-water mark.';

-- ---------------------------------------------------------------------------------------------
-- 2. Deterministic backfill for registrations that predate the column.
-- ---------------------------------------------------------------------------------------------
--
-- Ordered by `tenant_id` so the assignment is a function of the register's contents and nothing
-- else: the same register yields the same sequence numbers on every environment, which is what
-- makes the result reviewable. The relative order of rows that existed before this migration is
-- arbitrary either way — none of them can have been registered "after" another in a sense the old
-- schema recorded — so any deterministic order is as correct as any other.
--
-- Idempotent: it only touches rows whose sequence is still null, so re-running it is a no-op.
ALTER TABLE audit_chain_registry DISABLE TRIGGER audit_chain_registry_append_only;
WITH ordered AS (
  SELECT tenant_id, row_number() OVER (ORDER BY tenant_id) AS position
  FROM audit_chain_registry
  WHERE registration_seq IS NULL
)
UPDATE audit_chain_registry r
SET registration_seq = ordered.position
FROM ordered
WHERE r.tenant_id = ordered.tenant_id AND r.registration_seq IS NULL;
ALTER TABLE audit_chain_registry ENABLE ALWAYS TRIGGER audit_chain_registry_append_only;

-- ---------------------------------------------------------------------------------------------
-- 3. The sequence becomes authoritative for every future registration.
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE audit_chain_registry_registration_seq AS bigint
  OWNED BY audit_chain_registry.registration_seq;
-- Continues after whatever the backfill assigned, so a backfilled row and a new one can never
-- collide. `true` marks the value as already used.
SELECT setval(
  'audit_chain_registry_registration_seq',
  coalesce((SELECT max(registration_seq) FROM audit_chain_registry), 0) + 1,
  false
);
ALTER TABLE audit_chain_registry
  ALTER COLUMN registration_seq SET DEFAULT nextval('audit_chain_registry_registration_seq');
ALTER TABLE audit_chain_registry ALTER COLUMN registration_seq SET NOT NULL;
-- Strictly advancing: two registrations can never share a position in the population order.
ALTER TABLE audit_chain_registry
  ADD CONSTRAINT audit_chain_registry_registration_seq_key UNIQUE (registration_seq);

-- The register carries no runtime grant, and the sequence must not become the exception: a role
-- that can call `nextval` can move the high-water mark out from under a sweep.
REVOKE ALL ON SEQUENCE audit_chain_registry_registration_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE audit_chain_registry_registration_seq FROM moin_app, moin_provisioner;

-- Paging reads this in sequence order within a bounded range.
-- migration-check: allow create-index-blocking because the register holds one narrow row per tenant and is written once per provisioning; the brief lock is smaller than a second migration.
CREATE INDEX audit_chain_registry_seq_idx ON audit_chain_registry(registration_seq);

-- ---------------------------------------------------------------------------------------------
-- 4. The population contract, as three reviewed functions.
-- ---------------------------------------------------------------------------------------------
--
-- The UUID-cursor versions are replaced rather than kept: leaving them callable would leave the
-- defect reachable, and nothing outside this repository calls them.
DROP FUNCTION app.claim_audit_chains(integer, uuid);
DROP FUNCTION app.count_audit_chains(uuid);

-- A scalar, and deliberately nothing more. The sweep needs the bound, not the membership.
CREATE FUNCTION app.audit_chain_high_water()
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT coalesce(max(registration_seq), 0)::bigint FROM audit_chain_registry
$$;
REVOKE ALL ON FUNCTION app.audit_chain_high_water() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.audit_chain_high_water() TO moin_app;
COMMENT ON FUNCTION app.audit_chain_high_water()
  IS 'QG-09: a scalar only — the register high-water mark that bounds one sweep''s population.';

-- Identifiers plus the cursor, one page, inside the captured population. The `p_high_water` bound
-- is the caller's snapshot: a registration that lands mid-sweep is excluded by it, not by luck.
CREATE FUNCTION app.claim_audit_chains(p_limit integer, p_after bigint, p_high_water bigint)
  RETURNS TABLE (organisation_id uuid, id uuid, registration_seq bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT r.tenant_id AS organisation_id, r.tenant_id AS id, r.registration_seq
  FROM audit_chain_registry r
  WHERE r.registration_seq > coalesce(p_after, 0)
    AND r.registration_seq <= coalesce(p_high_water, 0)
  ORDER BY r.registration_seq
  LIMIT least(greatest(coalesce(p_limit, 0), 0), 1000)
$$;
REVOKE ALL ON FUNCTION app.claim_audit_chains(integer, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_audit_chains(integer, bigint, bigint) TO moin_app;
COMMENT ON FUNCTION app.claim_audit_chains(integer, bigint, bigint)
  IS 'QG-09: identifiers only — one page of the register population a sweep captured at its start.';

-- The shortfall, within the same captured population. A count, never identifiers.
CREATE FUNCTION app.count_audit_chains(p_after bigint, p_high_water bigint)
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM audit_chain_registry r
  WHERE r.registration_seq > coalesce(p_after, 0)
    AND r.registration_seq <= coalesce(p_high_water, 0)
$$;
REVOKE ALL ON FUNCTION app.count_audit_chains(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.count_audit_chains(bigint, bigint) TO moin_app;
COMMENT ON FUNCTION app.count_audit_chains(bigint, bigint)
  IS 'QG-09: a count only — register members still unvisited inside a sweep''s captured population.';
