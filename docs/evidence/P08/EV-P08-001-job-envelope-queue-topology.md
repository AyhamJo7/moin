# EV-P08-001: P08.01 envelope + topology: kernel lintEnvelope (UUID ids, closed type union, version/attempt, ISO notBefore, ID-only payload), JOB_QUEUES per class, visibility floors ≥6xp99; migration 0062 job_runs ledger (RLS+FORCE, app insert, dispatcher claim); enqueueJob + claimJob SKIP LOCKED with type narrowing; 5 unit + 2 integration tests; 3x fresh-DB green; mutation_check KILLED; gates full 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P08-001 |
| Item | P08.01.03 |
| Date (UTC) | 2026-10-13 02:08 UTC |
| Commit | `68918fce0252976f63f9cc4937a598f2d53b5e58` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 4.6 s); `pnpm lint` → pass (exit 0, 11.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 5.1 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → pass (exit 0, 23.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.0 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
