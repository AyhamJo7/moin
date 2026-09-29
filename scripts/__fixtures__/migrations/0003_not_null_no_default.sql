-- Violates: drop-not-null-column-add
ALTER TABLE tasks ADD COLUMN assigned_to uuid NOT NULL;
