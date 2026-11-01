# EV-P06-106: Round-1 review of PR 262 (two MEDIUM). Accept time: app.accept_invitation (new migration 0079) re-reads the issuer's current membership in the same transaction as the membership write. An owner or admin still active may confer; only an owner confers the owner role; a non-owner confers only the additive permissions it still holds; an unissued invitation confers plain admin or staff only. Refused acceptances write nothing, leave the invitation outstanding and answer rejected. Before: an invitation minted by an owner who was then demoted to admin without permissions was accepted and created a member holding billing_admin and integration_admin (reproduced by the reviewer as moin_app). After: rejected, no membership. Domain boundary: a direct issueInvitation test with unprivileged grantors fails when only the domain guard is reverted. mutation_check: accept-time KILLED (5 of 6 cases fail without the migration, the accepted control passes), domain guard KILLED (5 of 6 fail without it). The first gates full run failed on lint (inline SQL in the new tests matched the session-level SET rule; fixed in 6049c22), the second on the known invitation lock timing case fixed by draft 260, the third passed 14/14.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-106 |
| Item | P06.07.01 |
| Date (UTC) | 2026-11-01 17:45 UTC |
| Commit | `6049c22eaeec90bbc64b7b2df776bc04a17007ba` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 7.7 s); `pnpm lint` → pass (exit 0, 3.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.4 s); `pnpm test:integration` → pass (exit 0, 63.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.0 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
