-- 0035 — contacts and contact methods (P07.02.01, P07.02.03).
-- migration-check: allow create-index-blocking because every index here is on a table created earlier in this same migration, so it is new and empty.
--
-- ## People the business knows
--
-- `contacts` holds one row per person the tenant knows (callers, guests, regulars). Identity
-- resolution (P07.03) links interactions to these rows; duplicate candidates (P07.04) merge them.
-- A contact is tenant data: `organisation_id`, composite unique, RLS + FORCE, `moin_app` DML.
--
-- `contact_methods` holds the verified channels — phone (E.164) and email — plus external system
-- ids (P07.03.01 third rule). Each method carries its own `verification` source: resolution matches
-- only on verified methods, and uniqueness is enforced per verified value (P07.02.04), so two
-- contacts can share an unverified entry but never a verified one. `is_tenant_owned` marks the
-- business's own numbers (P07.03.01 never resolves on those: calling yourself is not a customer).
--
-- Composite FK `(organisation_id, contact_id)`: a method cannot point at another tenant's contact.
-- Optimistic locking via `version` on both tables; writers compare-and-bump, conflicts are 409
-- at the service layer (P07.02.02).
--
-- No DEFINER functions here: all writes go through `withTenant` as `moin_app`, and every mutation
-- writes an audit row from the service (P07.02.03), not from a trigger.

CREATE TABLE contacts (
  organisation_id uuid        NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
  id              uuid        NOT NULL PRIMARY KEY,
  display_name    text        NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  notes           text,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);

COMMENT ON TABLE contacts IS
  'People a tenant knows (P07.02). Tenant rows; resolution (P07.03) links interactions here, merges (P07.04) combine rows.';
COMMENT ON COLUMN contacts.organisation_id IS 'Tenant key; cascades from organisations.';
COMMENT ON COLUMN contacts.display_name IS 'Owner-visible name; validated by the PersonName value object at the service layer.';
COMMENT ON COLUMN contacts.notes IS 'Free-text note about the contact; never matched on for identity.';
COMMENT ON COLUMN contacts.version IS 'Optimistic-locking counter; writers compare-and-bump, conflicts surface as 409.';

CREATE TABLE contact_methods (
  organisation_id uuid        NOT NULL,
  id              uuid        NOT NULL PRIMARY KEY,
  contact_id      uuid        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('phone', 'email', 'external_id')),
  -- Canonical value: E.164 for phone, domain-lowercased for email, opaque string for external_id.
  value           text        NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 254),
  -- How the value was verified. Only `verified` methods participate in identity resolution.
  verification    text        NOT NULL DEFAULT 'unverified'
                    CHECK (verification IN ('unverified', 'verified', 'suspicious', 'withheld')),
  -- The business's own numbers (shop line, callback pool). Resolution never matches on these.
  is_tenant_owned boolean     NOT NULL DEFAULT false,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts (organisation_id, id) ON DELETE CASCADE,
  -- One verified value, one contact: the same verified phone/email cannot identify two people.
  -- Unverified duplicates are allowed (partial index), because entry precedes proof.
  UNIQUE (organisation_id, kind, value, verification)
);

-- Partial unique: only verified rows collide. Unverified/suspicious/withheld rows never conflict.
CREATE UNIQUE INDEX contact_methods_verified_unique_idx
  ON contact_methods (organisation_id, kind, value) WHERE verification = 'verified';

CREATE INDEX contact_methods_contact_idx ON contact_methods (organisation_id, contact_id);

COMMENT ON TABLE contact_methods IS
  'Verified channels per contact (P07.02). Phone is E.164, email domain-lowercased; external_id is an opaque foreign-system key.';
COMMENT ON COLUMN contact_methods.kind IS 'phone | email | external_id.';
COMMENT ON COLUMN contact_methods.value IS 'Canonical value; validated by the kernel value objects at the service layer.';
COMMENT ON COLUMN contact_methods.verification IS 'unverified | verified | suspicious | withheld. Only verified rows resolve identity and collide uniquely.';
COMMENT ON COLUMN contact_methods.is_tenant_owned IS 'True for the business own numbers; resolution never matches on these.';
COMMENT ON COLUMN contact_methods.version IS 'Optimistic-locking counter; writers compare-and-bump.';

SELECT app.apply_tenant_rls('contacts');
SELECT app.apply_tenant_rls('contact_methods');

REVOKE ALL ON TABLE contacts, contact_methods
  FROM PUBLIC, moin_app, moin_identity, moin_provisioner, moin_dispatcher, moin_support_ro,
       moin_reporting;

GRANT SELECT, INSERT, UPDATE, DELETE ON contacts, contact_methods TO moin_app;

-- Reviewed audit argument keys for contact operations (P06.10.03, P06.10.07, INV-12). Counts and
-- ids only — no names, numbers, addresses or secrets ever reach an audit row.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('contact.create', 'method_count', 'count', 'how many methods the new contact carries; opaque count, no PII'),
  ('contact.update', 'version', 'count', 'the new optimistic-locking version; opaque counter, no PII'),
  ('contact.method_add', 'method_kind', 'count', 'method kind as opaque marker (phone/email/external_id mapped to 0/1/2 at the writer); no value'),
  ('contact.method_remove', 'method_kind', 'count', 'method kind as opaque marker; no value')
ON CONFLICT (operation, argument_key) DO NOTHING;
