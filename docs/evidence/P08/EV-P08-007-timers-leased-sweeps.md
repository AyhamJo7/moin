# EV-P08-007: P08.07 timers + sweeps: migration 0067 tenant timers table (RLS+FORCE, composite uniques); scheduleTimer idempotent per kind+ref (earlier due wins); claimDueTimers SKIP LOCKED 5-min leases; completeTimer guarded; exactly-once under 3 concurrent sweepers; restart survival (expired leases re-claim, done never refires); 3x fresh-DB green; mutation_check KILLED; gates full 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P08-007 |
| Item | P08.07.04 |
| Date (UTC) | 2026-10-13 03:48 UTC |
| Commit | `1c71fe70abbca819a1325efb53cc0fe3035d4e8c` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.0 s); `pnpm lint` → pass (exit 0, 10.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 5.1 s); `pnpm test` → pass (exit 0, 5.3 s); `pnpm test:integration` → pass (exit 0, 23.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.0 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
