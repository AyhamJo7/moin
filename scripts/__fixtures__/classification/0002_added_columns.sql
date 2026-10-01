-- Columns added to an existing table, which the check once could not see at all.
--
-- It parsed only `CREATE TABLE`, so anything introduced with `ALTER TABLE … ADD COLUMN` never
-- reached the personal-data inventory and an erasure request would have missed it silently — the
-- exact failure the gate exists to prevent. The hole was found by adding such a column to a real
-- migration and noticing the checked-column count had not moved.
ALTER TABLE contacts ADD COLUMN personal_data text;
-- The variants the parser also has to handle: `IF NOT EXISTS`, a quoted name, and a column that
-- the inventory does classify, so the fixture proves both directions.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS later_nickname text;
ALTER TABLE contacts ADD COLUMN "quoted_secret" text;
ALTER TABLE contacts ADD COLUMN display_name_added text;
