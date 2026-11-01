# EV-P06-088: New functions not executable by PUBLIC: migration 0078, catalog PUBLIC-EXECUTE finding; mutation KILLED

| Field | Value |
|---|---|
| Evidence ID | EV-P06-088 |
| Item | P06.01.02 |
| Date (UTC) | 2026-11-01 04:06 UTC |
| Commit | `93418b06c49a61c8a6d1479fa2a2f16ad06d6c5d` (working tree had uncommitted changes) |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector) as a private compose project, local worktree /tmp/moin-sec01 |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 6.9 s); `pnpm lint` → pass (exit 0, 3.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 63.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What it proves

Finding F4 (MEDIUM), commit `90902a2`: migration `0078_function_default_privileges.sql` adds the global `ALTER DEFAULT PRIVILEGES FOR ROLE moin_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (0003 is untouched) and revokes PUBLIC's EXECUTE on the existing application functions; only `app.current_org()` held it, and every role that evaluates a tenant policy keeps its own grant. The catalog check reports any non-extension function PUBLIC can execute (`function-public-execute`).

Tests: `packages/db/src/function-default-privileges.integration.test.ts` creates a function as the real `moin_migrator` in `app` and in `public` and calls it as `moin_app`: 42501 before a grant, success after. `scripts/check-rls-catalog.integration.test.ts` (F4 block): a PUBLIC grant is reported, a revoke clears it, `app.current_org()` has no PUBLIC grantee. Before the fix the fresh functions resolved for `moin_app` and 4 tests failed. Mutation (`EV-P06-088-mutation-f4-default-privileges.json`, migration and checker as the fix paths): KILLED.

## Not shown

`moin_owner`-created functions are not covered by the default (local bootstrap role only; the check reports them). Independent re-review pending; nothing is VERIFIED.
