# EV-P06-051: CSRF synchronizer token plus Origin check for state-changing requests; double-submit folded into session guard; 4/4 C mutants kill; full gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P06-051 |
| Item | P06.06.06 |
| Date (UTC) | 2026-10-07 16:47 UTC |
| Commit | `cbf06af7a2ff156f7032926453a5d4738f20058e` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 3.6 s); `pnpm lint` → pass (exit 0, 6.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 2.7 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → pass (exit 0, 18.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 2.6 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | pending (PR to be opened as draft) |
| Reviewer | pending QG-09 triad at final SHA (security, architecture, invariant) |
| Mutation sweep | 5/5 C variants KILLED_ASSERTION (C1–C4, C7) (C1–C4, measured this session); C5 dropped (timing unobservable black-box), C6 dropped (vacuous — URL parsing already refuses opaque origins); 78-variant manifest resolves |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
