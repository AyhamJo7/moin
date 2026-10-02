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

-- Provisioning role: may execute provision_tenant() and nothing else (P06.04). Separate from the
-- application role because creating a tenant is the one operation that legitimately writes across
-- the tenancy boundary, and it must not be reachable from a request handler.
CREATE ROLE moin_provisioner WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- Bookkeeping pool for the worker: outbox, inbox, job history and timers. It touches no tenant
-- table, so a dispatcher bug cannot reach tenant data; tenant effects run afterwards as moin_app
-- inside withTenant.
CREATE ROLE moin_dispatcher WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- Support diagnostics. Reads tenant data only through views gated by an active support access
-- grant (P06.11), never directly.
CREATE ROLE moin_support_ro WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- Founder KPI dashboards: aggregate, PII-free views only.
CREATE ROLE moin_reporting WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

-- Sign-in and sessions (P06.06, ADR-0003 amendment): the api role's second pool, and the only role
-- that may execute the session functions. voice and worker never hold its credential, so neither
-- can mint, resolve, rotate or revoke a session even if compromised. It may do nothing else.
CREATE ROLE moin_identity WITH LOGIN PASSWORD 'local-development-only' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;

GRANT CONNECT ON DATABASE moin TO moin_app, moin_migrator, moin_readonly, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting, moin_identity;

-- PostgreSQL grants TEMPORARY on every database to PUBLIC. moin_identity may create nothing, so the
-- grant is moved from PUBLIC to the roles that had it, leaving moin_identity without it.
REVOKE TEMPORARY ON DATABASE moin FROM PUBLIC;
GRANT TEMPORARY ON DATABASE moin TO moin_app, moin_migrator, moin_readonly, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;

-- The public schema is not writable by default; P06 creates the application schema and grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO moin_app, moin_migrator, moin_readonly, moin_provisioner, moin_dispatcher, moin_support_ro, moin_reporting;
GRANT CREATE ON SCHEMA public TO moin_migrator;

-- The migrator is the DDL role, so it may also create schemas: P06 adds `app`, which holds the
-- helpers row-level-security policies call. Creating it needs CREATE on the database, not on a
-- schema, which is a distinction that costs an afternoon the first time it is met.
GRANT CREATE ON DATABASE moin TO moin_migrator;
