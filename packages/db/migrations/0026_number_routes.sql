-- 0026 — number routes: dialled number → tenant (P06.03.04, P11.01.01).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Why global, and what that costs
--
-- `number_routes` maps a dialled E.164 number to an organisation. It IS the tenant-resolution
-- step, so it cannot itself be tenant-scoped without circularity (global-tables.md rule 3):
-- the tenant column is deliberately named `route_organisation_id` (not `organisation_id`) so
-- the RLS helper — which keys policies off that exact column name — cannot attach a tenant
-- policy to it, and the catalog check treats the table as global (registered, with reason).
-- The cost of that exemption is paid three ways: the
-- table carries no payload (ids only), no runtime role can read it directly (DEFINER-only,
-- like `sessions`), and the one reader returns the minimum — two uuids, never the status,
-- never another tenant's rows.
--
-- ## Statuses (P11.01.01)
--
-- `active` routes resolve. `quarantined` (abuse hold or number in porting limbo) and
-- `released` (returned to the pool) resolve to nothing — the voice layer answers its
-- neutral unassigned message (P11.01.03), never another tenant. Status changes are
-- UPDATEs, never row deletes: the history of which tenant a number served stays queryable.
--
-- ## Same-tenant location guard
--
-- `location_id` must belong to the same organisation as the route. Locations carry
-- `UNIQUE (organisation_id, id)`, so a composite FK `(organisation_id, location_id)`
-- makes a cross-tenant pointer unrepresentable — not refused, unexpressible.
--
-- ## E.164 shape
--
-- `^\+[1-9][0-9]{6,14}$`: plus, non-zero first digit, 7–15 digits total (E.164 max).
-- Normalisation (spaces, dashes, leading 00) is the caller's job — the voice adapter's,
-- not the database's; the function matches exactly, and a non-normalised caller gets no
-- row rather than a wrong tenant.
--
-- No audit on route rows yet: P11 owns number lifecycle governance. No new roles.

CREATE TABLE number_routes (
  e164            text        NOT NULL PRIMARY KEY CHECK (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  route_organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  location_id     uuid        NOT NULL,
  status          text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'quarantined', 'released')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (route_organisation_id, location_id) REFERENCES locations (organisation_id, id)
);

COMMENT ON TABLE number_routes IS
  'Dialled number → tenant (P06.03.04, P11.01.01). Global by necessity (resolution precedes tenancy): ids only, DEFINER-only reads, active rows resolve, quarantined/released resolve to nothing.';

-- ---------------------------------------------------------------------------------------------
-- Grants: none. Like the session tables (0012): no runtime role reads the mapping directly.
-- The only reader is app.resolve_route below. Default privileges would have granted moin_app
-- DML, so revoke explicitly rather than leaving it to whichever role ran the DDL.
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON TABLE number_routes
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- ---------------------------------------------------------------------------------------------
-- resolve_route: the one reader (P06.03.04). Minimal return by construction.
-- ---------------------------------------------------------------------------------------------
--
-- Exact match on the normalised number, active rows only. Quarantined, released and unknown
-- numbers return zero rows — the caller distinguishes "no route" from a tenant, never one
-- tenant from another. Returns exactly (organisation_id, location_id): the status, the
-- timestamps and every other number's existence stay inside. No logging of the input
-- (INV-12): a dialled number is caller personal data.
--
-- STABLE (same answer within a scan, cheaper for the voice hot path), not VOLATILE; reads
-- one indexed row, takes no locks beyond the row read.

CREATE FUNCTION app.resolve_route(p_e164 text) RETURNS TABLE (organisation_id uuid, location_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public, app, pg_temp
AS $$
  SELECT r.route_organisation_id AS organisation_id, r.location_id
  FROM public.number_routes r
  WHERE r.e164 = p_e164
    AND r.status = 'active'
$$;

COMMENT ON FUNCTION app.resolve_route(text) IS
  'Tenant resolution for inbound voice/webhooks (P06.03.04): exact E.164 match, active rows only. Returns (organisation_id, location_id) and nothing else; quarantined/released/unknown yield zero rows.';

REVOKE ALL ON FUNCTION app.resolve_route(text) FROM PUBLIC;

-- The voice adapter resolves before any session exists, as does the webhook path: moin_app
-- executes (the api role serves both), moin_identity has none — a session function reachable
-- from the voice role is out of scope here by design (QG-09 I1 covers sessions, not routes).
GRANT EXECUTE ON FUNCTION app.resolve_route(text) TO moin_app;
