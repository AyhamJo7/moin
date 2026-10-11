-- 0053 — business profile structured facts (P09.02).
-- migration-check: allow create-index-blocking because every index here is on a table created
-- earlier in this same migration, so it is new and empty.
--
-- ## Why a NEW table, not knowledge_versions payloads
--
-- knowledge_versions (0052) stores free-text card bodies governed by the publish door
-- (DEFINER approve, lifecycle triggers). Profile facts are the opposite shape:
-- STRUCTURED per-category payloads (PLZ lists, numeric ranges, enum policies) with
-- per-category validation, plus deterministic German answer templates rendered from
-- the structure — not a body string. Stuffing JSONB into `body` would bypass the
-- category CHECKs, lose the per-field constraints below, and mix two lifecycles
-- (profile edits are staff-direct with optimistic locking, not draft→approve).
-- So: one row per (organisation, category), mutable by staff, version-bumped,
-- audited with markers. Categories are the BR-064 card set, fixed by CHECK.
--
-- ## Categories (BR-064 cards + address contact surface)
--
-- business_name (+ phonetic for STT read-back), address, directions, parking,
-- services (text list), service_area (PLZ list XOR radius), price_ranges (min/max
-- EUR cents + label), booking_policy, cancellation_policy, escalation_rules.
-- Payload columns are per-category-nullable with CHECKs tying presence to category,
-- so a service_area row cannot carry a price and a price row cannot carry PLZs.
--
-- Tenant rows: organisation_id, composite unique, RLS + FORCE, moin_app DML
-- (no DELETE — profile rows deactivate by emptying, erasure runs privileged).

CREATE TABLE business_profile (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  category        text        NOT NULL
                    CHECK (category IN ('business_name', 'address', 'directions', 'parking',
                      'services', 'service_area', 'price_ranges', 'booking_policy',
                      'cancellation_policy', 'escalation_rules')),
  -- business_name.
  name            text        CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  phonetic_name   text        CHECK (length(btrim(phonetic_name)) BETWEEN 1 AND 200),
  -- address.
  street          text        CHECK (length(btrim(street)) BETWEEN 1 AND 200),
  postal_code     text        CHECK (postal_code ~ '^[0-9]{5}$'),
  city            text        CHECK (length(btrim(city)) BETWEEN 1 AND 100),
  -- directions / parking / booking / cancellation / escalation (free text, capped).
  body            text        CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  -- services: text list (1..50 entries, each 1..120 chars).
  services        text[],
  -- service_area: PLZ list XOR radius_km + center PLZ.
  area_postcodes  text[],
  area_radius_km  integer     CHECK (area_radius_km BETWEEN 1 AND 200),
  area_center_plz text        CHECK (area_center_plz ~ '^[0-9]{5}$'),
  -- price_ranges: label + min/max EUR cents + currency (EUR-only until P23).
  price_label     text        CHECK (length(btrim(price_label)) BETWEEN 1 AND 120),
  price_min_cents integer     CHECK (price_min_cents >= 0),
  price_max_cents integer,
  price_currency  text        NOT NULL DEFAULT 'EUR' CHECK (price_currency = 'EUR'),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, category),
  CHECK (price_max_cents IS NULL OR price_min_cents IS NULL OR price_max_cents >= price_min_cents),
  CHECK (
    (category = 'business_name' AND name IS NOT NULL)
    OR (category = 'address' AND street IS NOT NULL AND postal_code IS NOT NULL AND city IS NOT NULL)
    OR (category IN ('directions', 'parking', 'booking_policy', 'cancellation_policy', 'escalation_rules') AND body IS NOT NULL)
    OR (category = 'services' AND services IS NOT NULL)
    OR (category = 'service_area')
    OR (category = 'price_ranges' AND price_label IS NOT NULL AND price_min_cents IS NOT NULL)
  ),
  CHECK (area_postcodes IS NULL OR category = 'service_area'),
  CHECK (area_radius_km IS NULL OR category = 'service_area'),
  CHECK (area_center_plz IS NULL OR category = 'service_area'),
  CHECK (price_label IS NULL OR category = 'price_ranges'),
  CHECK (price_min_cents IS NULL OR category = 'price_ranges'),
  CHECK (price_max_cents IS NULL OR category = 'price_ranges')
);

CREATE INDEX business_profile_category_idx ON business_profile (organisation_id, category);

COMMENT ON TABLE business_profile IS 'Structured business facts per category (P09.02, BR-064). One row per category; staff-direct edits with optimistic locking; deterministic German templates render from structure.';
COMMENT ON COLUMN business_profile.phonetic_name IS 'Phonetic business name for STT read-back confirmation.';
COMMENT ON COLUMN business_profile.area_postcodes IS 'PLZ list XOR radius: exactly one shape per service_area row (service-enforced).';

SELECT app.apply_tenant_rls('business_profile');

REVOKE ALL ON TABLE business_profile
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE ON business_profile TO moin_app;

-- Reviewed audit argument keys (P06.10.03, P06.10.07, INV-12). Category marker only.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('profile.upsert', 'category', 'count', 'profile category as opaque marker (0..9 in CHECK order); no names, addresses or prices'),
  ('profile.upsert', 'version', 'count', 'row version after write; concurrency marker, no content')
ON CONFLICT (operation, argument_key) DO NOTHING;
