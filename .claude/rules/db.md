---
paths:
  - "packages/db/**"
  - "apps/server/src/modules/**/infrastructure/**"
  - "scripts/check-migrations*"
  - "scripts/check-rls-catalog*"
---

# Database, RLS and migrations

Read first: `python3 .claude/bin/plan_section.py --section "Data Architecture"` (roles ADR-0003, RLS
pattern, transaction boundaries, migrations) and `--id INV-01`, `--id QG-08`.

- INV-01: every tenant row has `organisation_id NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policies
  for all commands; the runtime role is `NOBYPASSRLS` and owns no tables. New tenant table → new
  cross-tenant negative test in the same PR.
- INV-02: tenant context comes from the server-side session/routing, set per transaction (no session-level
  `SET`, no string-built SQL; the lint bans both).
- QG-08 / INV-17: expand/contract only; a migration must work with the previous release; backfills run
  as jobs; lock heuristics via `scripts/check-migrations.ts`.
- Tests touching data run against **real PostgreSQL 17 + pgvector** and must pass **standalone** on a
  freshly migrated and seeded database (Testing Strategy rules). Synthetic data only (INV-16).
