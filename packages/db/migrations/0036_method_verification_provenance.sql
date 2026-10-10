-- 0036 — verification provenance on contact methods (P07.02 round-2).
-- migration-check: allow drop-not-null-column-add because no column here is NOT NULL: the rule
-- matches the words "verified_via IS NOT NULL" inside the CHECK coupling provenance to
-- verification, not an ADD COLUMN ... NOT NULL. Both columns are nullable by design.
--
-- Verification is operator-attested, not self-asserted: no channel exists yet (voice/SMS/send
-- arrive P04/P14), so nobody can prove control of a number in-band. The owner or staff confirms
-- control out-of-band — called back, replied, showed an invoice, or the value arrived through a
-- trusted import/migration — and records HOW here. Resolution (P07.03) reads verified rows; it
-- never grants them, so this provenance is the only thing standing between "typed in" and
-- "reached a real person".
--
-- Additive only: two nullable columns plus a CHECK coupling them to `verification`. Existing rows
-- are all unverified with NULL provenance, so the constraint holds on apply with no backfill.

ALTER TABLE contact_methods
  ADD COLUMN verified_via text CHECK (
    verified_via IN (
      'owner_confirmed_call', 'owner_confirmed_reply', 'imported_verified', 'migrated'
    )
  ),
  ADD COLUMN verified_at timestamptz;

ALTER TABLE contact_methods ADD CHECK (
  (verification = 'verified' AND verified_via IS NOT NULL AND verified_at IS NOT NULL)
  OR (verification <> 'verified' AND verified_via IS NULL AND verified_at IS NULL)
);

COMMENT ON COLUMN contact_methods.verified_via IS
  'How control of the value was confirmed out-of-band. Set only on the unverified->verified transition, never NULL then, always NULL otherwise.';
COMMENT ON COLUMN contact_methods.verified_at IS
  'When control was confirmed (DB clock at transition). NULL unless verified.';

-- The verify audit row carries two opaque markers (INV-12): the method kind and the via. Strings
-- never reach the audit row; the service maps each via to 0..3.
INSERT INTO audit_argument_allowlist(operation, argument_key, value_kind, reason) VALUES
  ('contact.method_verify', 'verified_via', 'count', 'how control was confirmed as opaque marker (0..3 at the writer); no strings')
ON CONFLICT (operation, argument_key) DO NOTHING;
