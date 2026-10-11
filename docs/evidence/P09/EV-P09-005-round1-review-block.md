# EV-P09-005: ROUND-1 review BLOCK 2 findings: wall-clock resolve, exception spillover

| Field | Value |
|---|---|
| Evidence ID | EV-P09-005 |
| Item | P09.03.04 |
| Date (UTC) | 2026-10-11 14:28 UTC |
| Commit | `6c1e91e` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 5.1 s); `pnpm lint` → pass (exit 0, 11.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.6 s); `pnpm test` → pass (exit 0, 6.2 s); `pnpm test:integration` → pass (exit 0, 26.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.1 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.0 s) |
| Result | PASS |
| CI run / artifact | PR #98 (draft, this push): CI pending at push time |
| Reviewer | round-1 re-review BLOCK (2 findings, both valid); dispositions below |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/hours.integration.test.ts" --fix-paths packages/db/src/hours.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | ROUND-3 (1 API-shape): yesterdayDate no longer a caller param — shiftDateString derives it from the date (UTC-noon-anchored, DST-free date-only math); the 4-arg forgetful shape is inexpressible. Direct hoursOnDate row assertion for suppressed spill (no intervals). ROUND-2 (2 precision): yesterday-exception suppresses weekly spill (exceptions override weekly on the spill leg too — Friday closure kills Saturday 01:00; only yesterday overnight exception spills); DST-Sunday test gains Sunday 09:00 leg (same-day 09:00-local asserts discriminate old minute-math: spring 07:00Z, autumn 08:00Z CET). Stash-proven: closure test fails on old code. Wall-clock resolve: nextOpening no longer walks minute-deltas in elapsed ms (spring 00:30→09:00 landed 10:00, autumn landed 08:00) — wallMinutesOnDate builds the target DATE at the opening wall time through the noon offset (kernel addCalendarDays policy: noon resolve + gap 03:00 shift + fold first-occurrence). DST-Sunday tests assert exact 09:00-local instants both transitions. Exception spill-over: yesterday's midnight-spanning dated exception covers 00:00–close today (mirrors weekly spill, computed FIRST so it survives even under today's own exception — a started night cannot be un-started); Silvester test asserts both legs + end. Code-only fix, no migration change. Tests 9 (3x). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
