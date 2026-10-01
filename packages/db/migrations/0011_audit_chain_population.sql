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
-- ## Why a PostgreSQL sequence cannot be the authority
--
-- The obvious implementation — `registration_seq bigint DEFAULT nextval(...)` with
-- `max(registration_seq)` as the bound — is unsafe, and measured to be so. `nextval()` is
-- deliberately outside transaction control: it does not lock, does not roll back, and its
-- allocation order is **not** commit order. So this happens:
--
--   Tx A inserts a tenant, takes epoch 1, stays open
--   Tx B inserts a tenant, takes epoch 2, commits
--   a sweep reads max(registration_seq) over committed rows -> 2
--   the sweep's population is "<= 2"; only one of its two members is visible
--   Tx A commits
--   that same population now has two members, one of which the sweep never saw
--
-- Measured exactly: `high_water = 2`, one row visible during the sweep, two rows in that same
-- population afterwards. The sweep reported complete coverage of a population it had half covered,
-- which is the defect this file exists to remove — reintroduced one layer down.
--
-- ## The fix: an epoch serialized by a row lock, and a high-water mark
--
-- Epochs are allocated by incrementing a single authoritative row, **in the same transaction as
-- the registration itself**:
--
--   UPDATE audit_chain_population_state SET last_registration_epoch = last_registration_epoch + 1
--    RETURNING last_registration_epoch
--
-- PostgreSQL holds that row's write lock until the transaction commits or rolls back, so a second
-- registration cannot allocate until the first has resolved. Epoch order is therefore commit
-- order, and the state row's committed value is a true high-water mark: while epoch N is in
-- flight, no epoch above N can be committed, because nobody else can allocate one.
--
-- A sweep reads that value **once** at the start; its population is exactly
-- `registration_seq <= high_water`, paged `registration_seq > cursor` in that order. Two properties
-- follow, and they are the whole point:
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
-- 3. One authoritative allocator: a single row, incremented inside the registering transaction.
-- ---------------------------------------------------------------------------------------------
--
-- `id boolean PRIMARY KEY CHECK (id)` is the singleton idiom: exactly one row can exist, and it
-- cannot be `false`. There is deliberately **no sequence and no column default** — a dormant
-- `nextval()` default would be a second allocator waiting to be used by accident, and the whole
-- point is that there is exactly one.
CREATE TABLE audit_chain_population_state (
  id boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (id),
  last_registration_epoch bigint NOT NULL DEFAULT 0 CHECK (last_registration_epoch >= 0)
);
COMMENT ON TABLE audit_chain_population_state IS
  'Global singleton: the audit register''s committed registration epoch. Incremented in the same transaction as each registration, so epoch order is commit order.';

-- Seeded from the backfill above, so a backfilled row and a newly allocated epoch can never
-- collide, and an empty register starts at zero.
INSERT INTO audit_chain_population_state(id, last_registration_epoch)
VALUES (true, coalesce((SELECT max(registration_seq) FROM audit_chain_registry), 0));

-- No runtime grant. A role that can increment this row can move a sweep's population bound out
-- from under it, which is exactly the attack the epoch exists to prevent. Default privileges hand
-- `moin_app` DML on new tables in `public`, so this is taken back explicitly rather than assumed.
REVOKE ALL ON audit_chain_population_state FROM moin_app, moin_provisioner;

ALTER TABLE audit_chain_registry ALTER COLUMN registration_seq SET NOT NULL;
-- Strictly advancing: two registrations can never share a position in the population order.
ALTER TABLE audit_chain_registry
  ADD CONSTRAINT audit_chain_registry_registration_seq_key UNIQUE (registration_seq);

-- Paging reads this in sequence order within a bounded range.
-- migration-check: allow create-index-blocking because the register holds one narrow row per tenant and is written once per provisioning; the brief lock is smaller than a second migration.
CREATE INDEX audit_chain_registry_seq_idx ON audit_chain_registry(registration_seq);

-- ---------------------------------------------------------------------------------------------
-- The registration trigger becomes the allocator.
-- ---------------------------------------------------------------------------------------------
--
-- The epoch is taken and the register row written in one statement sequence inside whatever
-- transaction is inserting the organisation, so the two commit or roll back together. The `UPDATE`
-- is first and is what serializes: every registration takes the same row's write lock, in the same
-- order, and holds it until it resolves.
--
-- Lock order for anything that registers a tenant is therefore fixed and documented:
--   organisations row -> audit_chain_population_state singleton -> audit_chain_registry row
--   -> (provisioning only) provisioning_requests row -> audit_heads row
-- Nothing in the codebase takes these in any other order, which is what makes the singleton safe
-- to hold briefly. The verification sweep takes none of them: it reads the state value and lets go.
--
-- Not SECURITY DEFINER: every path that may insert an organisation — the provisioning definer, a
-- migration — already owns or is granted this table, and `moin_app` cannot insert an organisation
-- at all. A role that somehow could, and that lacks this grant, fails closed rather than silently
-- registering nothing.
CREATE OR REPLACE FUNCTION app.register_audit_chain() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public, app, pg_temp
AS $$
DECLARE
  v_epoch bigint;
BEGIN
  UPDATE audit_chain_population_state
     SET last_registration_epoch = last_registration_epoch + 1
   WHERE id
  RETURNING last_registration_epoch INTO v_epoch;
  IF v_epoch IS NULL THEN
    RAISE EXCEPTION 'audit chain population state is missing, so no registration epoch can be allocated'
      USING ERRCODE = 'internal_error';
  END IF;
  INSERT INTO audit_chain_registry(tenant_id, registration_seq)
  VALUES (NEW.id, v_epoch) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.register_audit_chain() FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- 4. The population contract, as three reviewed functions.
-- ---------------------------------------------------------------------------------------------
--
-- The UUID-cursor versions are replaced rather than kept: leaving them callable would leave the
-- defect reachable, and nothing outside this repository calls them.
DROP FUNCTION app.claim_audit_chains(integer, uuid);
DROP FUNCTION app.count_audit_chains(uuid);

-- A scalar, and deliberately nothing more. The sweep needs the bound, not the membership.
--
-- Read from the state row rather than as `max(registration_seq)` over the register, and the
-- difference is the whole correctness argument: while epoch N is in flight the register has no
-- visible row for it, so `max()` would return N-1 or lower *and* no higher epoch can exist — but
-- `max()` over committed rows is only equal to the real bound by accident, and is wrong the moment
-- a higher epoch commits first. Allocation is serialized, so this row's committed value is the
-- exact boundary: every epoch at or below it belongs to a transaction that has already committed
-- or rolled back, and none above it can have committed.
CREATE FUNCTION app.audit_chain_high_water()
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT last_registration_epoch FROM audit_chain_population_state WHERE id
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
