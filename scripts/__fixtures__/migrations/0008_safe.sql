-- Safe: nullable add, then a concurrent index in its own migration.
-- A comment that says DROP COLUMN must not trigger the rule.
ALTER TABLE contacts ADD COLUMN preferred_language text;
