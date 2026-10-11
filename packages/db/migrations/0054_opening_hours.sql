-- 0054 — opening-hours engine tables (P09.03.01).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## Shape: weekly rules + dated exceptions, per location
--
-- `opening_rules`: weekly recurrence — one row per (location, weekday, interval):
-- multiple intervals per day (09:00–12:00 + 14:00–18:00), minutes-since-midnight in
-- the location's wall clock (Europe/Berlin per locations.time_zone; the kernel
-- resolves DST — the stored values are wall-clock, never UTC instants).
-- Midnight-spanning intervals (22:00–02:00) are stored open > close and split at
-- query time (22:00–24:00 on day D + 00:00–02:00 on day D+1).
--
-- `opening_exceptions`: dated overrides per location — kind holiday (public holiday
-- with custom hours or closed), closure (single closed day/range), vacation
-- (Betriebsferien: multi-day range, P07.14 deferral lands here as tenant data, never
-- in the global holidays file). A range is [start_date, end_date] inclusive; a single
-- day has end_date = start_date. Hours NULL = closed all day; else override opens.
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE, moin_app DML
-- (no DELETE on rules — deactivation by deletion is a staff act through the service
-- with audit; erasure runs privileged).

CREATE TABLE opening_rules (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  location_id     uuid        NOT NULL,
  -- 0=Sunday … 6=Saturday (matches kernel zonedFields weekday).
  weekday         integer     NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  -- Minutes since midnight, wall-clock: 0..1439. open may exceed close for
  -- midnight-spanning intervals (e.g. 1320..120 = 22:00–02:00).
  opens_min       integer     NOT NULL CHECK (opens_min BETWEEN 0 AND 1439),
  closes_min      integer     NOT NULL CHECK (closes_min BETWEEN 0 AND 1439),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, location_id, weekday, opens_min, closes_min),
  FOREIGN KEY (organisation_id, location_id) REFERENCES locations (organisation_id, id) ON DELETE CASCADE,
  CHECK (opens_min <> closes_min)
);

CREATE TABLE opening_exceptions (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  location_id     uuid        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('holiday', 'closure', 'vacation')),
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  -- NULL = closed all day; else override opening intervals (same minutes encoding).
  opens_min       integer     CHECK (opens_min IS NULL OR (opens_min BETWEEN 0 AND 1439)),
  closes_min      integer     CHECK (closes_min IS NULL OR (closes_min BETWEEN 0 AND 1439)),
  label           text        CHECK (label IS NULL OR length(btrim(label)) BETWEEN 1 AND 120),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, location_id) REFERENCES locations (organisation_id, id) ON DELETE CASCADE,
  CHECK (start_date <= end_date),
  CHECK ((opens_min IS NULL) = (closes_min IS NULL)),
  CHECK (opens_min IS NULL OR opens_min <> closes_min)
);

CREATE INDEX opening_rules_location_idx ON opening_rules (organisation_id, location_id);
CREATE INDEX opening_exceptions_location_idx ON opening_exceptions (organisation_id, location_id);

COMMENT ON TABLE opening_rules IS 'Weekly opening intervals per location (P09.03.01). Wall-clock minutes; open>close spans midnight; DST resolved by the kernel at query time.';
COMMENT ON TABLE opening_exceptions IS 'Dated opening overrides per location (P09.03.01): holiday/closure/vacation (Betriebsferien land here as tenant data). NULL hours = closed.';
COMMENT ON COLUMN opening_exceptions.kind IS 'holiday = public holiday override; closure = single closed day; vacation = Betriebsferien multi-day range.';

SELECT app.apply_tenant_rls('opening_rules');
SELECT app.apply_tenant_rls('opening_exceptions');

REVOKE ALL ON TABLE opening_rules, opening_exceptions
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON opening_rules, opening_exceptions TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('hours.set', 'scope', 'count', 'rule/exception write as opaque marker (0=rule,1=exception); no times or labels'),
  ('hours.set', 'version', 'count', 'row version after write; concurrency marker, no content')
ON CONFLICT (operation, argument_key) DO NOTHING;
