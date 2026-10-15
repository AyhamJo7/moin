# EV-P11-016: absenceAlarms trailing-run silence check over expected-busy windows + 2h default + SEV2 metric + Weiterleitung owner message; baseline + canary drill ride separately; fire/quiet tests; unit 46/46 3x + integration green in gates; mutation KILLED; gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P11-016 |
| Item | P11.18.02 |
| Date (UTC) | 2026-10-13 22:34 UTC |
| Commit | `aa1e7a40c31d71fead6fecd1e6c9920c9c7e82c1` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.3 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.4 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 7.0 s); `pnpm lint` → pass (exit 0, 10.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 3.5 s); `pnpm test` → pass (exit 0, 7.2 s); `pnpm test:integration` → pass (exit 0, 28.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.0 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
