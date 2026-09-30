# EV-P06-020: Real PostgreSQL privilege, rollback, isolation and catalog attacks

| Field | Value |
|---|---|
| Evidence ID | EV-P06-020 |
| Item | P06.04.05 |
| Date (UTC) | 2026-09-29 21:53 UTC |
| Commit | `127ba14acb4e4b594a7a6db32180bf30d582c98d` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 23.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.5 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 2.6 s); `pnpm lint` → pass (exit 0, 8.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 4.0 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → pass (exit 0, 4.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

Standalone real-PostgreSQL run: `provisioning.integration.test.ts` 13/13 and
`check-rls-catalog.integration.test.ts` 13/13. The full gate includes the earlier cross-tenant
and transaction-local context suites. The deliberate PostgreSQL
fault occurs after three tenant inserts and rolls back both tenant state and the cap counter;
retry succeeds. An unregistered definer, wrong owner, mutable `search_path`, unexpected EXECUTE
grant and arbitrary definer are rejected. A caller-created temporary cap table cannot shadow
the reviewed function's table resolution. QG-09 founder review is pending.
