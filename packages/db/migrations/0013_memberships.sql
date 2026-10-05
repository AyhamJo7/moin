-- 0013 — memberships: who may act for which organisation (P06.06.03, ADR-0005, INV-01, INV-02).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## Tenant rows, not identity rows
--
-- A session says *who* is signed in; it does not say which organisation they act for (0012
-- header). `memberships` is where that link lives: one row per person per organisation, carrying
-- the role and the status P06.06.03 re-checks on every request. It therefore carries
-- `organisation_id`, is under the single tenant policy via `app.apply_tenant_rls`, and is NOT on
-- the global register: a table with customer data and no tenant column is a leak, not a design.
--
-- ## Status is the FS-16 enforcement point
--
-- `status` is a closed CHECK set. A removed member has no row; a disabled or suspended member has
-- a row the per-request check refuses. Either way the next request fails: removal and disablement
-- need no session sweep because no request trusts a session without re-reading this table.
--
-- ## Roles and permissions follow PLAN, not the provider
--
-- `role` is owner/admin/staff; `permissions` is the additive capability set (integration_admin,
-- billing_admin) as a text array bounded by CHECK. Provider claims never reach these columns:
-- they are written by invitation acceptance and role management (P06.07/P06.08), never by sign-in.
-- Last-owner protection is P06.07.04; this table only makes the state expressible.
--
-- ## Composite keys, as everywhere else
--
-- `UNIQUE (organisation_id, id)` like every tenant table, plus `UNIQUE (organisation_id,
-- user_id)`: one membership per person per organisation. The `user_id` foreign key points at the
-- global `users` table, which is catalog-clean (the check constrains tenant-to-tenant edges only).

CREATE TABLE memberships (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES users (id),
  role            text        NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  permissions     text[]      NOT NULL DEFAULT '{}'
    CHECK (permissions <@ ARRAY['integration_admin', 'billing_admin']),
  status          text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'suspended')),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, user_id)
);

CREATE INDEX memberships_organisation_idx ON memberships (organisation_id);
CREATE INDEX memberships_user_idx ON memberships (organisation_id, user_id);

COMMENT ON TABLE memberships IS
  'Who may act for which organisation (P06.06.03, FS-16). Tenant rows: re-checked on every request; a removed member has no row, a disabled or suspended one is refused. Roles and permissions are ours, never provider claims.';

SELECT app.apply_tenant_rls('memberships');

-- ---------------------------------------------------------------------------------------------
-- Scoped lookup exception for the per-request re-check (P06.06.03, 0014).
-- ---------------------------------------------------------------------------------------------
--
-- The single-policy helper above is the rule for every ordinary reader: tenant set, same tenant
-- visible. The per-request lookup runs before any tenant is known, so it needs one narrow
-- additional USING disjunct, and only under two simultaneous conditions: the transaction-local
-- marker `app.request_lookup = 'resolve_request_context'` — set solely by that pinned function
-- around its own membership read and reset before return — AND `current_user = 'moin_migrator'`,
-- which holds only inside code running as that DEFINER's owner. No runtime role can satisfy
-- both: `moin_identity` has no table grant at all, and `moin_app` never runs as the migrator.
-- WITH CHECK stays the tenant rule, so the exception can never write across tenants: the
-- function that sets the marker performs no write.
CREATE POLICY memberships_request_lookup ON memberships FOR ALL
  USING (
    organisation_id = app.current_org()
    OR (
      current_setting('app.request_lookup', true) = 'resolve_request_context'
      AND current_user = 'moin_migrator'
    )
  )
  WITH CHECK (organisation_id = app.current_org());

-- ---------------------------------------------------------------------------------------------
-- Grants: moin_app reads and writes inside withTenant; nothing else touches this table.
-- ---------------------------------------------------------------------------------------------
--
-- Reads happen on every request (P06.06.03) and writes on disable/remove (FS-16, P06.06.05);
-- both run as moin_app inside withTenant. moin_identity — the session credential — gets no
-- grant: the per-request lookup joins through the session DEFINER function, never by giving
-- the session role a path to tenant rows (the session-boundary catalog assertion enforces this).
REVOKE ALL ON TABLE memberships
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO moin_app;
