-- 0005 — organisations and locations (P06.04.01), the first tenant tables.
--
-- ## `organisations` is its own tenant
--
-- Every other tenant table has an `organisation_id` pointing at a row here. This table's tenant
-- *is* the row, so the column is generated from `id` rather than stored twice — one column, one
-- truth, and the same policy as everywhere else applies without a special case. A special case in
-- the isolation rule is how the isolation rule gets forgotten.
--
-- ## Composite keys are the second lock
--
-- Every tenant table carries `UNIQUE (organisation_id, id)`, and every child references its parent
-- with a **composite** foreign key `(organisation_id, parent_id)`. Row-level security stops a
-- query returning another tenant's rows; the composite key stops a row *pointing* at another
-- tenant's row, which RLS alone would happily allow if the application supplied a foreign id.
-- Two independent mechanisms, because the interesting failures are the ones that defeat one.
--
-- ## Status is a closed set
--
-- The lifecycle in PLAN's Data Architecture, as a CHECK rather than a comment. A status the
-- application invents is rejected at write time rather than discovered in a report.

CREATE TABLE organisations (
  id           uuid        NOT NULL PRIMARY KEY,
  -- The tenant key, derived so it can never disagree with the identity it names.
  organisation_id uuid GENERATED ALWAYS AS (id) STORED,
  slug         citext      NOT NULL UNIQUE,
  name         text        NOT NULL CHECK (length(btrim(name)) > 0),
  status       text        NOT NULL DEFAULT 'trial'
                 CHECK (status IN ('trial', 'pilot', 'active', 'suspended', 'terminating', 'deleted')),
  time_zone    text        NOT NULL DEFAULT 'Europe/Berlin',
  early_access boolean     NOT NULL DEFAULT false,
  version      integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);

COMMENT ON TABLE organisations IS 'A tenant. Its own organisation_id is generated from its id.';
COMMENT ON COLUMN organisations.early_access IS
  'Counted against the Early Access cap in provision_tenant() until the P30 pentest is complete.';

CREATE TABLE locations (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL,
  name            text        NOT NULL CHECK (length(btrim(name)) > 0),
  street          text,
  postal_code     text,
  city            text,
  country_code    text        NOT NULL DEFAULT 'DE' CHECK (country_code ~ '^[A-Z]{2}$'),
  time_zone       text        NOT NULL DEFAULT 'Europe/Berlin',
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organisation_id, id),
  -- A direct child of `organisations` needs only the tenant column: the parent *is* the tenant,
  -- so there is no second identity to get wrong. Children of ordinary tenant tables carry the
  -- composite key `(organisation_id, parent_id)` instead, which is what stops a row pointing at
  -- another tenant's row.
  FOREIGN KEY (organisation_id) REFERENCES organisations (id) ON DELETE CASCADE
);

-- migration-check: allow create-index-blocking because the table is created three statements
-- above this one and cannot contain a row, so there is nothing to block.
CREATE INDEX locations_organisation_idx ON locations (organisation_id);

COMMENT ON TABLE locations IS 'A physical site of a tenant. The first ordinary tenant table.';

SELECT app.apply_tenant_rls('organisations');
SELECT app.apply_tenant_rls('locations');

-- Granted explicitly rather than left to default privileges. Default privileges depend on which
-- role ran the DDL, and a table nobody can read is a failure that surfaces far from its cause.
--
-- The application role may not INSERT an organisation: creating a tenant legitimately precedes
-- the existence of the tenant it belongs to, so it goes through provision_tenant() in P06.04 as
-- moin_provisioner. Nor may it DELETE one; termination is a retention-engine path, audited.
GRANT SELECT, UPDATE ON TABLE organisations TO moin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE locations TO moin_app;
