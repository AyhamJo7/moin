# EV-P06-064: Cognito lockout docs half: authentication-lockout runbook with AWS-quoted backoff (5 fails 1s doubling to ~15min, 2^(n-5)s, 15-min quiet reset, subject-to-change), app-throttle table, layer identification, operator procedure; advanced-security UNVERIFIED until P06.05.01; WAF still EXT-09, item NOT ticked

| Field | Value |
|---|---|
| Evidence ID | EV-P06-064 |
| Item | P06.12.01 |
| Date (UTC) | 2026-10-08 18:55 UTC |
| Commit | `58e71c919c22871d19fcab1ef12fdc89633f8677` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py fast`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 29.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.9 s); `pnpm exec prettier --check .` → skipped (exit None, 0.0 s); `pnpm lint` → skipped (exit None, 0.0 s); `pnpm typecheck` → skipped (exit None, 0.0 s); `pnpm test` → skipped (exit None, 0.0 s) |
| Result | PASS (SKIPPED-UNVERIFIED: format, lint, typecheck, unit) |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
