-- 0047 — Berlin-only tenant time zones (P07.14 round-5).
-- migration-check: allow create-index-blocking? No indexes here — two CHECK constraints on
-- empty-at-addition columns only (existing rows all carry the Berlin default, verified below
-- by the NOT VALID + VALIDATE split, which takes no write lock on either table).
--
-- ## Why CHECK constraints, not a provision-function edit
--
-- `app.provision_tenant` (0007, MERGED and immutable) validates any `pg_timezone_names`
-- zone, but the kernel time helpers accept ONLY Europe/Berlin (P07.14 round-4: EU gap/fold
-- constants are Berlin-specific and would silently misresolve elsewhere). A tenant
-- provisioned with another zone would be provisionable-then-crashing. The function body
-- cannot be edited (applied migrations are immutable), so enforcement lands on the tables:
-- any INSERT — through the function or by hand — with another zone fails closed (23514).
-- Tightening the function's own validation message to Berlin-only awaits a provision
-- function v2 (P05-owned); the CHECK is the enforcement, the friendlier error is polish.
--
-- ## Expand/contract shape
--
-- ADD CONSTRAINT ... NOT VALID + VALIDATE CONSTRAINT: existing rows (all Berlin default)
-- are checked without blocking concurrent writes; there is nothing to backfill.

ALTER TABLE organisations ADD CONSTRAINT organisations_berlin_time_zone
  CHECK (time_zone = 'Europe/Berlin') NOT VALID;
ALTER TABLE organisations VALIDATE CONSTRAINT organisations_berlin_time_zone;

ALTER TABLE locations ADD CONSTRAINT locations_berlin_time_zone
  CHECK (time_zone = 'Europe/Berlin') NOT VALID;
ALTER TABLE locations VALIDATE CONSTRAINT locations_berlin_time_zone;

COMMENT ON CONSTRAINT organisations_berlin_time_zone ON organisations IS
  'P07.14: Berlin-only pilot — kernel time helpers accept only Europe/Berlin. Provision-function validation tightening awaits v2 (P05); this CHECK is the enforcement.';
COMMENT ON CONSTRAINT locations_berlin_time_zone ON locations IS
  'P07.14: Berlin-only pilot — see organisations_berlin_time_zone.';
