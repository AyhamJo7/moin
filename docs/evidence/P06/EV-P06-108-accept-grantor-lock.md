# EV-P06-108: Round 2 of the independent review of PR 262 (MEDIUM). Migration 0081 makes app.accept_invitation take the organisation ownership lock before it reads the issuer and read the issuer's membership and account rows FOR SHARE to the end of the transaction, so a demotion, permission removal, disable or removal of the issuer cannot commit between the authority check and the grant. Before: acceptance read an authorised owner, blocked on the acceptor's existing account row, the issuer was demoted and committed meanwhile, and acceptance then granted billing_admin (three of three runs as moin_app). After: the demotion queues behind the acceptance and follows it. Regression, as the runtime role against real Postgres with a holder pinning the acceptor's row: fails without the migration (the demotion committed mid-acceptance), passes with it; mutation_check KILLED; 20 of 20 stress iterations; gates full PASS 14/14 on the second run (the first failed on the invitation lock timing case fixed by draft 260). BLOCKER for the ADR-0046 accept route: it must not be exposed before this change. Based on the 262 branch because migration 0079 is not on main yet.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-108 |
| Item | P06.08.02 |
| Date (UTC) | 2026-11-03 15:11 UTC |
| Commit | `d8212bcdc0000e33d73686a83b4ec6c51b3fc709` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.0 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 7.5 s); `pnpm lint` → pass (exit 0, 3.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.3 s); `pnpm test:integration` → pass (exit 0, 63.7 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.4 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
