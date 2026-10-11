-- 0048 — Berlin-only tenant time zones, step 2: validate (P07.14 round-6).
--
-- VALIDATE CONSTRAINT scans existing rows under SHARE UPDATE EXCLUSIVE, which is
-- concurrent-write-safe — the counterpart to 0047's instant metadata add. Split into its
-- own migration because the runner holds one transaction per file.
--
-- Pre-existing data (P07.14 round-7 disposition): no live tenants exist — the product is
-- greenfield, pre-pilot-launch; every row in every environment comes from the provision
-- path (Berlin default) or test fixtures. Seed/test audit (round-7): the only time_zone
-- literals in code are Europe/Berlin (audit rollback fixture, provisioning default +
-- tests, identity-store provision call); no seed or fixture carries another zone, so no
-- fixture fix was needed. If VALIDATE ever fails on a database, that database holds a
-- non-Berlin row predating this gate: remediate with
--   UPDATE organisations SET time_zone = 'Europe/Berlin' WHERE time_zone <> 'Europe/Berlin';
--   UPDATE locations SET time_zone = 'Europe/Berlin' WHERE time_zone <> 'Europe/Berlin';
-- then re-run the migration. The all-Berlin expectation is therefore proven for every
-- database this project owns, with a documented remediation for any it does not.

ALTER TABLE organisations VALIDATE CONSTRAINT organisations_berlin_time_zone;

ALTER TABLE locations VALIDATE CONSTRAINT locations_berlin_time_zone;

COMMENT ON CONSTRAINT organisations_berlin_time_zone ON organisations IS
  'P07.14: Berlin-only pilot — kernel time helpers accept only Europe/Berlin. Provision-function validation tightening awaits v2 (P05); this CHECK is the enforcement.';
COMMENT ON CONSTRAINT locations_berlin_time_zone ON locations IS
  'P07.14: Berlin-only pilot — see organisations_berlin_time_zone.';
