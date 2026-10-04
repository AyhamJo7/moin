# EV-P06-042: Dedicated moin_identity database role closing QG-09 I1; executes exactly the six session functions with zero table privileges, NOBYPASSRLS, and no database CREATE; 43/43 mutation sweep KILLED_ASSERTION; 14/14 full gates and 20x stress pass; supersedes EV-P06-041

| Field | Value |
|---|---|
| Evidence ID | EV-P06-042 |
| Item | P06.01.06 |
| Date (UTC) | 2026-10-04 02:36 UTC |
| Commit | `74a579d87bf9ca6a9ab33a975e70c4203ab6cd35` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 3.3 s); `pnpm lint` → pass (exit 0, 3.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 1.0 s); `pnpm test` → pass (exit 0, 5.9 s); `pnpm test:integration` → pass (exit 0, 10.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.6 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
