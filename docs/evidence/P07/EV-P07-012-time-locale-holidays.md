# EV-P07-012: tenant time plus German formatting plus Hamburg holidays plus 14 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-012 |
| Item | P07.14.01 |
| Date (UTC) | 2026-10-11 00:48 UTC, round-1 fix 2026-10-11 ~01:05 UTC, round-2 fix 2026-10-11 ~01:15 UTC, round-3 fix 2026-10-11 ~01:30 UTC, round-4 fix 2026-10-11 ~01:45 UTC, round-5 fix 2026-10-11 ~02:00 UTC, round-6 fix 2026-10-11 ~02:10 UTC, round-7 fix 2026-10-11 ~02:20 UTC |
| Commit | `bc6b03414c8a2685ff32c6f2ea08ae09641fb6ce` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261011T021333Z-full.json`, on this head); time-locale unit suite 14/14 green; mutation-check KILLED | LEGACY-DUMP: `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 30.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.7 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 2.0 s); `pnpm exec prettier --check .` → pass (exit 0, 6.6 s); `pnpm lint` → pass (exit 0, 16.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.3 s); `pnpm typecheck` → pass (exit 0, 7.5 s); `pnpm test` → pass (exit 0, 8.0 s); `pnpm test:integration` → pass (exit 0, 26.3 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 7.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #91 at `946b31e`: 16/16 checks SUCCESS (verified); this round-7 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `fbca476` (1 HIGH + 1 note, both fixed: Berlin offsets outside the pinned table fall through to the Intl round-trip path; zonedFields carries second+millisecond and addCalendarDays preserves them); round 2: spring-forward gap shifts forward to the first existing minute (round-trip repair, fold stays first-occurrence); round 3: exact 03:00 gap resolve (noon-offset + first-minute, no blind stepping) + hourly fold step-back to the true first occurrence, both asserted exactly |

| Mutation | `mutation_check.py --test "pnpm exec vitest run --project unit packages/kernel/src/time-locale.test.ts" --fix-paths packages/kernel/src/tenant-time.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No migration: holidays are a kernel data file (Map lookup by Bundesland+date), not a table — the `public_holidays` global table stays reserved for the day queries need SQL. Betriebsferien are tenant data for the P09 opening_exceptions table, never the global file. No new deps (Intl built-in). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
