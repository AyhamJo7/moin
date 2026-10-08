# EV-P06-057: Support access grants: lifecycle, grant-gated reads, audit, emergency access

| Field | Value |
|---|---|
| Evidence ID | EV-P06-057 |
| Item | P06.11.02, P06.11.03, P06.11.04, P06.11.05 |
| Date (UTC) | 2026-10-08 02:39 UTC |
| Commit | `393089abcd0dc086e0d2c452a9fa3ff1c65e8c75` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 3.9 s); `pnpm lint` → pass (exit 0, 7.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 4.1 s); `pnpm test` → pass (exit 0, 5.5 s); `pnpm test:integration` → pass (exit 0, 19.3 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.8 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending QG-09 triad at final SHA (security, architecture, invariant) |

| Mutation sweep | KILLED: support.integration.test.ts detects the fix (fails without, passes with; mutation-check working-tree mode, this session) |
| Scope note | P06.11.01 operator pool + ALB OIDC WAITING_FOR_EXTERNAL (P05/EXT-09): the operator is an opaque subject named by the owner, unauthenticated here. Owner notification on grant/emergency PENDING (P06.12.02/P14 unwired) — emergency audit carries flags, never the reference text, and claims no notification. Support reads exclude sessions/tokens/secrets by construction. |
| Review fix | eefae29 closes HIGH (all 4 read functions lose every runtime EXECUTE grant until P06.11.01 trusted identity + emergency auth check; refusal proven at privilege layer 42501 with no rows/audit), MEDIUM lock-first gate (row lock before clock_timestamp expiry judgement + lock-wait test), MEDIUM step-up on grant listing; full gates 14/14 |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
