-- Local development roles (P02.04.01), mirroring ADR-0003's production role split.
--
-- The split exists locally for one reason: row-level security is invisible to a superuser. A
-- developer who runs everything as the owner will never see an RLS policy fail, and the first
-- time the policy matters will be in staging with real data. So the application connects as a
-- NOBYPASSRLS role that owns nothing, exactly as it does in production (INV-01).
--
-- These passwords are development-only. Production credentials live in AWS Secrets Manager and
-- are referenced by ARN (INV-15).

-- Application runtime role: no BYPASSRLS, no table ownership, no DDL.
CREATE ROLE moin_app WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- Migration role: owns the schema and is the only role permitted to run DDL. Separate from the
-- runtime role so an application-level SQL injection cannot alter the schema.
CREATE ROLE moin_migrator WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- Read-only role for local inspection and future analytics; also NOBYPASSRLS, so a support
-- query cannot accidentally read across tenants.
CREATE ROLE moin_readonly WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

GRANT CONNECT ON DATABASE moin TO moin_app, moin_migrator, moin_readonly;

-- The public schema is not writable by default; P06 creates the application schema and grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO moin_app, moin_migrator, moin_readonly;
GRANT CREATE ON SCHEMA public TO moin_migrator;
