-- migration-check: allow drop-column because the expand half shipped in v0.4.0 and nothing reads it
ALTER TABLE contacts DROP COLUMN legacy_phone;
