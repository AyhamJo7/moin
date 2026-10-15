# EV-P10-003: withResilience decorator: purpose deadlines cap caller budget, retryable-only retries, breaker 5-failures-30s open-60s half-open probe, token cap 8000; FS-02 tests; gateway 18/18 3x green, mutation KILLED, gates 9/14 (integration env-blocked, DB-free slice)

| Field | Value |
|---|---|
| Evidence ID | EV-P10-003 |
| Item | P10.04.04 |
| Date (UTC) | 2026-10-13 14:01 UTC |
| Commit | `632ee1158675660c6f0a1be1fa1dd2477ff8d053` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.1 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.0 s); `pnpm lint` → pass (exit 0, 4.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 2.8 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → fail (exit 1, 0.5 s); `node scripts/check-migrations.ts` → skipped (exit None, 0.0 s); `pnpm turbo run build` → skipped (exit None, 0.0 s); `node scripts/check-licences.ts` → skipped (exit None, 0.0 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → skipped (exit None, 0.0 s) |
| Result | FAIL (SKIPPED-UNVERIFIED: migrations, build, licences, secret-scan) |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
