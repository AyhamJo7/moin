# EV-P06-061: Real-route RBAC matrix: 11 product routes x owner/admin/staff through IdentityAccessModule; 5 tests green; guard always-allow mutant KILLED (2 fail); probe+members+recovery+support 51 green

| Field | Value |
|---|---|
| Evidence ID | EV-P06-061 |
| Item | P06.07.05 |
| Date (UTC) | 2026-10-08 16:12 UTC |
| Commit | `311eb0d520a7344795cb9d28253eedfdc5767bf1` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.0 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → skipped (exit None, 0.0 s); `pnpm lint` → skipped (exit None, 0.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → skipped (exit None, 0.0 s); `pnpm typecheck` → skipped (exit None, 0.0 s); `pnpm test` → skipped (exit None, 0.0 s); `pnpm test:integration` → skipped (exit None, 0.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → skipped (exit None, 0.0 s); `node scripts/check-licences.ts` → skipped (exit None, 0.0 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS (SKIPPED-UNVERIFIED: format, lint, boundaries, typecheck, unit, integration, build, licences) |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
