# EV-P06-089: Cross-tenant write matrix generated from the live catalog (55 tables), migration helper lint; weakened-table controls and policy-installer mutants killed

| Field | Value |
|---|---|
| Evidence ID | EV-P06-089 |
| Item | P06.02.06 |
| Date (UTC) | 2026-11-01 04:06 UTC |
| Commit | `93418b06c49a61c8a6d1479fa2a2f16ad06d6c5d` (working tree had uncommitted changes) |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector) as a private compose project, local worktree /tmp/moin-sec01 |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 6.9 s); `pnpm lint` → pass (exit 0, 3.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 63.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What it proves

Findings F5 (MEDIUM) and F6 (LOW).

**F5, commit `c7f4a4d`:** `packages/db/src/tenant-write-matrix.integration.test.ts` reads every table with an `organisation_id` column from the catalog (55 today), seeds a visible row for tenant A and one for tenant B, and as `moin_app` checks: no context reads nothing; A reads only A; an INSERT naming B is refused; an UPDATE moving A's row to B is refused; UPDATE and DELETE of B's rows touch nothing; both rows are unchanged. 54 tables are seeded generically (CHECK constraints followed from their own text, ten reviewed per-table overrides); `audit_events` is the one registered exception (ENABLE ALWAYS guard triggers), and the test fails if an entry goes stale or a table cannot be seeded and is unregistered. The cross-tenant suite pins the live count of 55. Weakened controls (WITH CHECK true, USING true, RLS off) are rejected in-suite; two manual mutants of the policy installer were killed (`EV-P06-089-mutants-write-matrix.json`: 34 and 99 violations). The official mutation tool does not apply to a test-only change.

**F6, commit `863901f`:** `scripts/check-migrations.ts` rejects a new migration that enables RLS by hand, writes a policy without `app.apply_tenant_rls`, or creates a tenant table that never reaches the helper; 12 older migrations covering 14 tables are grandfathered by name. Before: 3 of 5 new tests failed. Mutation (`EV-P06-089-mutation-f6-helper-lint.json`): KILLED.

**Lint fixes, `93418b0`:** the first full-gate run failed at lint; the second reached integration and failed only on the missing server build; the third, recorded here, passed 14/14.

## Not shown

The matrix does not prove the policies of the `SECURITY DEFINER` paths (covered by their own suites). `public routes answer without tenant data` in the cross-tenant suite needs the local OIDC provider; it passed in the full run with it. Independent re-review pending; nothing is VERIFIED.
