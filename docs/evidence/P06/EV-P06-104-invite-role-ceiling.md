# EV-P06-104: Group 9 M1: an inviter cannot confer more than it holds. Before: an admin POST /api/members/invite with permissions billing_admin or integration_admin returned 201 and stored the invitation. After: 403 forbidden with no row written; an admin holding billing_admin confers only billing_admin; an owner confers both; issueInvitation refuses the same case as defence in depth. Real-HTTP tests (3) and decision-table tests (3 more). mutation_check.py: KILLED (without fix 2 failed with expected 201 to be 403; with fix exit 0, record in EV-P06-104-mutation-invite-role-ceiling.json). The first gates full run failed once on the invitation-lock timing case (draft #260 fixes it); the rerun passed 14/14.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-104 |
| Item | P06.07.01 |
| Date (UTC) | 2026-11-01 15:07 UTC |
| Commit | `03b91ed7d8066f9883d2ee6ce88adb659e76640c` |
| Environment | local clone /tmp/moin-h1, Node 24.21.0, private compose project implh1 (Postgres 17, moin_app NOSUPERUSER) |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 7.0 s); `pnpm lint` → pass (exit 0, 3.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 64.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
