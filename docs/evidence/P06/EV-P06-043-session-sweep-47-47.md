# EV-P06-043: 47/47 session mutation kills at 21cffd2

| Field | Value |
|---|---|
| Evidence ID | EV-P06-043 |
| Item | P06.06.02 |
| Date (UTC) | 2026-10-04 20:17 UTC |
| Commit | `effb49435688ee845224aa53777596d28c81aa4a` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py fast`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.5 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 3.7 s); `pnpm lint` → pass (exit 0, 9.3 s); `pnpm typecheck` → pass (exit 0, 4.5 s); `pnpm test` → pass (exit 0, 6.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
