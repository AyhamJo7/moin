# EV-P06-052: session lifecycle acceptance suite end to end over HTTP on a fresh database; 4/4 L mutants kill; full gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P06-052 |
| Item | P06.06.07 |
| Date (UTC) | 2026-10-07 17:38 UTC |
| Commit | `d08203a44561d168a1389a36dc343cf567054b77` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 3.7 s); `pnpm lint` → pass (exit 0, 10.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 4.7 s); `pnpm test` → pass (exit 0, 5.5 s); `pnpm test:integration` → pass (exit 0, 18.7 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.1 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | pending (PR to be opened as draft) |
| Reviewer | pending QG-09 triad at final SHA (security, architecture, invariant) |
| Mutation sweep | 4/4 L variants KILLED_ASSERTION (L1–L4, measured this session); L3 sharpened with a cross-user victim step, L4 retargeted store-level after proving the removal trigger masks the JOIN at HTTP level; 83-variant manifest resolves |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
