# EV-P06-090: withSystemWork claim survives a lost connection: shared checked-out-client handling with withTenant; child-process regression test; mutation KILLED

| Field | Value |
|---|---|
| Evidence ID | EV-P06-090 |
| Item | P06.14.01 |
| Date (UTC) | 2026-11-01 04:11 UTC |
| Commit | `71a45511bdd71196de0a3ce1ef3bfd4d56cc0644` |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector) as a private compose project, local worktree /tmp/moin-sec02 |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.1 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 6.9 s); `pnpm lint` → pass (exit 0, 11.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 6.1 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 64.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What it proves

SEC-G02 finding F1 (HIGH) of the independent security acceptance review of group 2 (be4591d): `withSystemWork` checked out its claim connection with no error listener and released it without noting a failed rollback, so a claim that lost its connection raised an unhandled `error` event and ended the process that runs the sweep.

Fix, commit `71a4551`: the checked-out-client handling of `withTenant` (error listener for the life of the checkout, the caller's error preserved, the client released as broken when rollback fails, listener removed on release) is one helper, `inTransaction`, used by both wrappers. There is no second copy.

Regression test: `packages/db/src/system-work-connection-loss.integration.test.ts` runs `system-work-connection-loss.child.ts` in a child process with the real `moin_app` pool (rolsuper false, rolbypassrls false). The claim kills its own backend. Asserted: the claim rejects, nothing is uncaught, the pool holds no dead client, a fresh query succeeds, the child exits 0.

- Before the fix: the child ends on the unhandled `error` event and the test fails (log `/tmp/moin-review/sec-g02-before.log`).
- After: passes. `withTenant`'s existing connection-loss test and `tenant.integration.test.ts` (23 tests) still pass.
- Official `mutation_check.py` over `packages/db/src/tenant.ts`: KILLED (without fix exit 1, with fix exit 0, byte-identical restore); record beside this file.

## Not shown

F2 (exclusive, expiring claim leases) and F3 (trace enrichment) of the same review are status corrections for the ledger, not part of this change. Independent re-review pending; nothing is VERIFIED.
