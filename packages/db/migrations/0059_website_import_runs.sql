-- 0059 — website import runs (P09.08 PILOT).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## What this adds (additive only — no column rewrites, no backfills)
--
-- 1. `business_domains`: the tenant-verified domain registry (P09.08.02). A
--    website import is allowed ONLY for urls whose registrable domain matches
--    a verified row for the calling tenant. Verification itself is founder /
--    ops-driven (DNS check outside this migration); this table records the
--    outcome. One row per (tenant, domain).
-- 2. `knowledge_import_runs`: one row per website-import attempt. The run
--    records the REQUESTED url + the VERIFIED domain it was checked against,
--    the outcome (drafts created, or the refusal reason), and links created
--    draft items. Draft items themselves live in knowledge_items/versions
--    (source='import', P09.01 shape) — this table is the audit trail of the
--    FETCH, not a second content store. Imported drafts flow through the
--    P09.05 approval door like any other draft: never auto-approved (INV-08).
--
-- No PDF/menu columns here (P09.08.03 LAUNCH — deferred, see note below).
--
-- Tenant rows: organisation_id, composite uniques/FKs, RLS + FORCE via
-- apply_tenant_rls (new tables — apply explicitly).

CREATE TABLE business_domains (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  -- Registrable domain (eTLD+1 as verified, e.g. beispiel-restaurant.de).
  -- Lowercase ASCII: verified by the ops flow, not free text.
  domain          text NOT NULL CHECK (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  verified_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  -- One registry entry per domain per tenant.
  UNIQUE (organisation_id, domain)
);

CREATE INDEX business_domains_lookup_idx ON business_domains (organisation_id, domain);

SELECT app.apply_tenant_rls('business_domains');

REVOKE ALL ON TABLE business_domains
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

-- moin_app reads the registry on every import (domain check); writes stay
-- privileged (ops-verified) — erasure runs privileged.
GRANT SELECT ON business_domains TO moin_app;

COMMENT ON TABLE business_domains IS 'Tenant-verified website domains (P09.08.02): website import is allowed only for urls under a verified row. Verification is ops-driven (DNS); this table records the outcome.';

CREATE TABLE knowledge_import_runs (
  organisation_id uuid NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid NOT NULL PRIMARY KEY,
  -- The url the owner asked to import (verbatim, for the audit trail).
  source_url      text NOT NULL CHECK (length(btrim(source_url)) BETWEEN 1 AND 2000),
  -- The domain the url was verified against (business_domains row).
  verified_domain text NOT NULL CHECK (length(btrim(verified_domain)) BETWEEN 1 AND 253),
  status          text NOT NULL DEFAULT 'succeeded'
                    CHECK (status IN ('succeeded', 'refused', 'failed')),
  -- Machine-readable refusal/failure reason (unverified-domain, robots-denied,
  -- too-large, timeout, invalid-content, fetch-error). NULL on success.
  refusal_reason  text CHECK (refusal_reason IS NULL OR length(btrim(refusal_reason)) BETWEEN 1 AND 80),
  -- Draft items created by this run (empty on refused/failed runs).
  draft_item_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  CHECK (
    (status = 'succeeded' AND refusal_reason IS NULL)
    OR (status <> 'succeeded' AND refusal_reason IS NOT NULL)
  )
);

CREATE INDEX knowledge_import_runs_org_idx
  ON knowledge_import_runs (organisation_id, created_at DESC);

SELECT app.apply_tenant_rls('knowledge_import_runs');

REVOKE ALL ON TABLE knowledge_import_runs
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT ON knowledge_import_runs TO moin_app;

COMMENT ON TABLE knowledge_import_runs IS 'Website-import audit trail (P09.08.02): requested url + verified domain + outcome + draft links. Drafts themselves live in knowledge tables (source=import) and need P09.05 approval — never auto-approved (INV-08). PDF/menu upload is LAUNCH (P09.08.03) — deferred, no columns here.';

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Markers only — never bodies or urls.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('knowledge.import', 'drafts', 'count', 'drafts created by the run; no urls or content'),
  ('knowledge.import_refused', 'reason', 'count', 'refusal reason marker; no urls or content')
ON CONFLICT (operation, argument_key) DO NOTHING;
