# EV-P06-065: Global number_routes (0026) with resolve_route(e164) DEFINER returning org+location only; 6 store-layer tests green (active resolves, quarantined/released/unknown empty, cross-tenant isolation, no-tenant globality, FK unrepresentable, E.164 rejected); mutation KILLED; DEFINER allowlist + digest pin + QG-09 contract; global-tables registered; privacy inventory extended. Annotation only, NOT ticked

| Field | Value |
|---|---|
| Evidence ID | EV-P06-065 |
| Item | P06.03.04 |
| Date (UTC) | 2026-10-08 19:36 UTC |
| Commit | `14106e97abb0d78a2c9da484df2cd590234293ff` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py fast`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 29.1 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.9 s); `pnpm exec prettier --check .` → skipped (exit None, 0.0 s); `pnpm lint` → skipped (exit None, 0.0 s); `pnpm typecheck` → skipped (exit None, 0.0 s); `pnpm test` → skipped (exit None, 0.0 s) |
| Result | PASS (SKIPPED-UNVERIFIED: format, lint, typecheck, unit) |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
