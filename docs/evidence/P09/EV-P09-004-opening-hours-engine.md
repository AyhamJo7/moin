# EV-P09-004: P09.03 opening-hours engine: rules, exceptions, queries, 6 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P09-004 |
| Item | P09.03.04 |
| Date (UTC) | 2026-10-11 14:01 UTC |
| Commit | `3ef91b2` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 4.7 s); `pnpm lint` → pass (exit 0, 12.6 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.4 s); `pnpm test` → pass (exit 0, 6.0 s); `pnpm test:integration` → pass (exit 0, 25.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.0 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #98 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #98) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/hours.integration.test.ts" --fix-paths packages/db/src/hours.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | 0054 two tables (opening_rules weekly + opening_exceptions dated holiday/closure/vacation), RLS+FORCE, composite location FKs, wall-clock minutes storage. Pure kernel-driven queries: zonedFields/zonedDateString/addCalendarDays (Berlin-only) + publicHolidayOn Hamburg — no AI. Exception-wins (NULL hours = closed with label), holidays need explicit rows (silence keeps regular hours), midnight spans split across days (yesterday spill-over leg), nextOpening 366-day cap, describeWeek deterministic German from Monday. Writes staff-direct (replace-all rules + single exceptions), audit scope+version markers only (INV-12). P07.14 deferral lands here: Betriebsferien = vacation-kind tenant rows (EV-P07-012 cross-ref). Inventory per-column Business rows (label possibly-personal). Tests 6 (3x): weekly open/close + next-Monday, midnight span both days, vacation-close + holiday-reason + override-open, DST spring/autumn wall-clock, German week text, invalid + RLS-23503 isolation. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
