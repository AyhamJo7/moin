-- 0048 — Berlin-only tenant time zones, step 2: validate (P07.14 round-6).
--
-- VALIDATE CONSTRAINT scans existing rows (all Berlin default) under SHARE UPDATE
-- EXCLUSIVE, which is concurrent-write-safe — the counterpart to 0047's instant metadata
-- add. Split into its own migration because the runner holds one transaction per file.

ALTER TABLE organisations VALIDATE CONSTRAINT organisations_berlin_time_zone;

ALTER TABLE locations VALIDATE CONSTRAINT locations_berlin_time_zone;

COMMENT ON CONSTRAINT organisations_berlin_time_zone ON organisations IS
  'P07.14: Berlin-only pilot — kernel time helpers accept only Europe/Berlin. Provision-function validation tightening awaits v2 (P05); this CHECK is the enforcement.';
COMMENT ON CONSTRAINT locations_berlin_time_zone ON locations IS
  'P07.14: Berlin-only pilot — see organisations_berlin_time_zone.';
