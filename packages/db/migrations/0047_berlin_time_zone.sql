-- 0047 — Berlin-only tenant time zones, step 1: add NOT VALID (P07.14 round-6).
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
-- ## Why two migrations (0047 + 0048)
--
-- The runner wraps each migration in ONE transaction: ADD CONSTRAINT ... NOT VALID takes
-- ACCESS EXCLUSIVE only for the metadata add (instant, no scan), but holding the same
-- transaction open through VALIDATE would keep that lock to commit. So 0047 adds both
-- constraints NOT VALID and commits; 0048 VALIDATEs them (SHARE UPDATE EXCLUSIVE,
-- concurrent-write-safe) in its own transaction.

ALTER TABLE organisations ADD CONSTRAINT organisations_berlin_time_zone
  CHECK (time_zone = 'Europe/Berlin') NOT VALID;

ALTER TABLE locations ADD CONSTRAINT locations_berlin_time_zone
  CHECK (time_zone = 'Europe/Berlin') NOT VALID;
