# EV-P06-021: Tenant audit table with append-only trigger and no runtime write grant

| Field | Value |
|---|---|
| Evidence ID | EV-P06-021 |
| Item | P06.10.01 |
| Date (UTC) | 2026-09-30 14:02 UTC |
| Commit | `8e5bf76f5ac9ec00e2394036927aefb092d5b763` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 7.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 4.2 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 4.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

Standalone real-PostgreSQL run: `packages/db/src/audit.integration.test.ts` 11/11.

`audit_events` and `audit_heads` are tenant tables under FORCE RLS with `UNIQUE (organisation_id,
id)` and `UNIQUE (organisation_id, seq)`. `moin_app` and `moin_provisioner` hold no INSERT, UPDATE,
DELETE or TRUNCATE grant; `moin_app` has SELECT only, and the writer function is the sole write
path. `app.reject_audit_mutation()` rejects UPDATE and DELETE **including for the table owner** —
asserted in-suite by attempting both through the privileged connection.

The catalog check verifies the guard from `pg_catalog` rather than from the migration: it asserts the
trigger exists, is enabled (`tgenabled = 'O'`), is row-level BEFORE UPDATE OR DELETE (`tgtype = 27`)
and points at the exact reviewed function. `scripts/check-rls-catalog.integration.test.ts` proves
that check fires on a disabled guard, a dropped guard and a guard repointed at a function that
returns without raising.
