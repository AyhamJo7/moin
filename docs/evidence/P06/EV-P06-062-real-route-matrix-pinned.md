# EV-P06-062: Real-route matrix with pinned EXPECTED route-to-capability table at 33c4202: 5 tests green; 3 mutants KILLED (guard always-allow 2 fail, weakened manage-owners->manage 2 fail, removed Require 3 fail); CI 16/16 green on PR52 head 33c4202; supersedes EV-P06-061 commit ref

| Field | Value |
|---|---|
| Evidence ID | EV-P06-062 |
| Item | P06.07.05 |
| Date (UTC) | 2026-10-08 16:53 UTC |
| Commit | `33c420204885cc5479c36299ebd797895be2e318` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py fast`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.0 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → skipped (exit None, 0.0 s); `pnpm lint` → skipped (exit None, 0.0 s); `pnpm typecheck` → skipped (exit None, 0.0 s); `pnpm test` → skipped (exit None, 0.0 s) |
| Result | PASS (SKIPPED-UNVERIFIED: format, lint, typecheck, unit) |
| CI run / artifact | 16/16 green on PR52 head `33c4202`: verify workflow run 37811128080 (success), incl. integration tests (real postgres), unit tests, format/lint/typecheck/boundaries/docs; container-scan run 37811128109, security-scan run 37811128179 — all success |
| Reviewer | pending (founder verifies) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
