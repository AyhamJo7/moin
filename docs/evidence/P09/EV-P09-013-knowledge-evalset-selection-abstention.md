# EV-P09-013: P09.11 eval set: synthetic Musterrestaurant + fictional Gurlitt-shaped variant, 8 cards via public createFaqCard; 15-question fixed set (variants, near-miss, off-catalogue) via findAnswer; selection + abstention metrics; RLS isolation test; 3x green on evalset+faq+retrieval suites; mutation-check KILLED; gates full 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P09-013 |
| Item | P09.11.02 |
| Date (UTC) | 2026-10-13 01:32 UTC |
| Commit | `d362576c368d1ed06fd5660ed722c431348e689d` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 5.2 s); `pnpm lint` → pass (exit 0, 3.3 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 1.2 s); `pnpm test` → pass (exit 0, 6.7 s); `pnpm test:integration` → pass (exit 0, 26.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.8 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
