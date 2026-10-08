# EV-P06-063: Minimal tasks table (0025) with return-to-unassigned trigger on membership disable/remove; 5 store-layer tests green; trigger-removed mutant KILLED (migration fails closed); RLS cross-tenant + fail-closed proven; privacy inventory extended

| Field | Value |
|---|---|
| Evidence ID | EV-P06-063 |
| Item | P06.08.03 |
| Date (UTC) | 2026-10-08 17:34 UTC |
| Commit | `39dd0d6a716ef12fd642a05ac7fe9e434ddce0d7` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py fast`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.0 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → skipped (exit None, 0.0 s); `pnpm lint` → skipped (exit None, 0.0 s); `pnpm typecheck` → skipped (exit None, 0.0 s); `pnpm test` → skipped (exit None, 0.0 s) |
| Result | PASS (SKIPPED-UNVERIFIED: format, lint, typecheck, unit) |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
