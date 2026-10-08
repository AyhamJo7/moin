# EV-P06-063: Minimal tasks table (0025) with return-to-unassigned trigger on membership disable/remove; 6 store-layer tests green (incl. 72/73 title boundary); trigger-removed mutant KILLED; RLS cross-tenant + fail-closed proven; DEFINER allowlist, catalog pin and privacy inventory extended; CI 16/16 green on PR54 head f909ea6, merged as d4fe924

| Field | Value |
|---|---|
| Evidence ID | EV-P06-063 |
| Item | P06.08.03 |
| Date (UTC) | 2026-10-08 18:20 UTC |
| Commit | `f909ea6ef737fd4500334af52311b8456e1d7e26` |
| Environment | local (direct runs) and GitHub Actions CI |
| Command / procedure | Local direct runs (this worktree; `gates.py` code gates are pnpm-gated and skipped there, so they are UNVERIFIED locally and verified by CI below): `node ./node_modules/vitest/vitest.mjs run --project integration packages/db/src/tasks-unassign.integration.test.ts` → 6 tests passed (exit 0): disable returns their tasks and keeps others', remove returns their tasks, demote-to-admin (still active) keeps their tasks, same user in another tenant keeps theirs (RLS), titles over 72 chars rejected with 23514 and exactly 72 accepted, FORCE RLS fail-closed with no tenant set; `node ./node_modules/vitest/vitest.mjs run --project integration scripts/check-rls-catalog.integration.test.ts` → 44 passed (exit 0), covering the `app.unassign_member_tasks` allowlist row, body-digest pin and `unassign-trigger-unsafe` assertion; mutation: `.claude/bin/mutation_check.py` against the suite → KILLED (trigger absent: the migration fails closed and the tests fail); `pnpm exec eslint` and `pnpm exec prettier --check` on the touched files → clean. Review fixes recorded: DEFINER allowlist/catalog registration (2a37378), 72-char title CHECK with boundary test and 12-month retention reconciled with the Work inventory table (f909ea6) |
| Result | PASS locally for the direct runs above; `gates.py` format, lint, typecheck, unit skipped locally (UNVERIFIED there, covered by CI) |
| CI run / artifact | PR54 head `f909ea6`: 16/16 checks green via `gh pr checks 54`, run heads confirmed `f909ea6` by `gh run view`. verify run 37820096523 (format/lint/typecheck/boundaries/docs job 113458602962, unit tests job 113458603020, integration tests (real postgres) job 113458602862, RLS catalog check job 113458602734, build job 113458602899, OpenAPI drift job 113458602859, end-to-end job 113458602775, verify job 113459987700); container-scan run 37820096646; security-scan run 37820096510 (dependency audit and licences, secret scan, semgrep/actionlint/shellcheck, trivy filesystem and SBOM); pr-title run 37820096505. PR54 squash-merged to main as `d4fe924336a85dc1b4a135f1aef5000a150c3c0e` |
| Reviewer | pending (founder verifies) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
