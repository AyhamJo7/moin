-- A table with a column the inventory has never seen. This is what the check must catch: a
-- column added in a later phase that nobody classified, which an erasure request would then
-- miss silently.
CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  display_name text,
  secret_nickname text,
  created_at timestamptz NOT NULL DEFAULT now()
);
