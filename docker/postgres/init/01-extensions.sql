-- Extensions the application depends on (P02.04.01).
--
-- Created by the init script rather than by a migration because `CREATE EXTENSION` needs
-- privileges the migration role deliberately does not have, and because staging and production
-- create them through Terraform against RDS for the same reason.

CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: knowledge retrieval (P09)
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest() for the audit hash chain
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email comparison
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy contact matching (P07)
