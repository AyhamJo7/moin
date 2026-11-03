# EV-P06-107: G09 M2 and L1. Transfer-ownership racing a removal deadlocked (40P01) and answered 500 in about 3 of 10 runs because each path locked a membership row before the last-owner triggers took the per-organisation advisory lock. Every ownership path (disable, remove, transfer, account disable and enable) now takes that lock first through one helper; a deadlock or serialisation failure that still occurs answers 409 with a retry hint; disable-user under the last-owner race answers 409 instead of 500. Before: a request queued on the lock already held the target row lock (remove, disable, transfer) and the 12-round transfer-versus-removal race and the disable-user race answered 500 (5 of 5 new tests fail). After: no row lock held while queued, 0 server errors, 409 on the race. mutation_check KILLED with the three source files reverted and the tests intact. Stress: the 5 new tests 20 of 20 iterations passed. gates full PASS 14/14. The OIDC service for the integration gate was served by another private stack on port 8080 because this stack's own container could not bind it.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-107 |
| Item | P06.07.04 |
| Date (UTC) | 2026-11-03 14:35 UTC |
| Commit | `ee4e8af6b8ef08c5a1394b65bde573e2360d7abd` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 29.0 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 7.8 s); `pnpm lint` → pass (exit 0, 12.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.3 s); `pnpm typecheck` → pass (exit 0, 7.1 s); `pnpm test` → pass (exit 0, 6.9 s); `pnpm test:integration` → pass (exit 0, 65.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
