# EV-P07-010: finaliser plus reconciler plus 8 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-010 |
| Item | P07.11.01 |
| Date (UTC) | 2026-10-10 22:22 UTC |
| Commit | `8ac8129471f84b6c7b494f986e7970d10e8a23cf` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 30.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.8 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 2.1 s); `pnpm exec prettier --check .` → pass (exit 0, 6.6 s); `pnpm lint` → pass (exit 0, 16.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.3 s); `pnpm typecheck` → pass (exit 0, 7.1 s); `pnpm test` → pass (exit 0, 7.9 s); `pnpm test:integration` → pass (exit 0, 24.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 7.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #89 (draft, this push): CI pending at push time |
| Reviewer | pending (codex review requested on PR #89) |
| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/finaliser.integration.test.ts" --fix-paths packages/db/src/finaliser.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No new DEFINER: a claim function over `conversations` cannot work tenant-less under FORCE RLS (SECURITY DEFINER changes who runs, not what the policy sees — verified by probe: same WHERE returns the row inside `withTenant`, nothing outside). The sweep pages tenants via reviewed `app.claim_audit_chains` and checks orphans per-tenant inside `withTenant`. Metric `interactions.orphaned` = report.orphaned; alarm wiring (log/metric/CloudWatch, 5-min schedule) is P08/P15 — the `onOrphan` callback and `orphanSeverity` helper are the contract. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
