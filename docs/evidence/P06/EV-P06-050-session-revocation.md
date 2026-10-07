# EV-P06-050: server-side revocation on membership change, reset and demand; trigger + overloads; 8/8 RV mutants kill; full gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P06-050 |
| Item | P06.06.05 |
| Date (UTC) | 2026-10-07 14:22 UTC |
| Commit | `745163b9cd54ca13546548e596938fe2604fd41f` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 3.7 s); `pnpm lint` → pass (exit 0, 9.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 4.8 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → pass (exit 0, 17.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | pending (PR to be opened as draft) |
| Reviewer | pending QG-09 triad re-run at final SHA (security, architecture, invariant) |
| Mutation sweep | 8/8 RV variants KILLED_ASSERTION (RV1–RV8, measured this session against `745163b`; RV9 dropped as behavior-neutral); 64 pre-existing variants untouched, anchors validated (72-variant manifest resolves; SU2/SU3 retargeted to the proof-required body) |
| QG-09 status | NOT re-run at this SHA: the triad recorded in EV-P06-049 predates five session-function commits plus this migration. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
