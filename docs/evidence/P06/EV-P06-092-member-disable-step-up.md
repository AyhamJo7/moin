# EV-P06-092: Member disable requires a fresh step-up; every identity-access route classified in the real-route matrix; mutation KILLED

| Field | Value |
|---|---|
| Evidence ID | EV-P06-092 |
| Item | P06.06.04 |
| Date (UTC) | 2026-11-01 04:24 UTC |
| Commit | `0949e9320fa9c281ca495a3ae4e6db8da3e5c90b` |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector) as a private compose project, local worktree /tmp/moin-sec06 |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.1 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 6.9 s); `pnpm lint` → pass (exit 0, 11.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 6.2 s); `pnpm test` → pass (exit 0, 6.4 s); `pnpm test:integration` → pass (exit 0, 64.7 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What it proves

Finding F1 (HIGH) of the independent security acceptance review of group 6 (be4591d): `POST /api/members/disable` had the role, session and CSRF protection but not `RequireStepUpGuard`. An owner session with a sixteen-minute-old step-up stamp disabled a member with 200 while the same session was refused 403 on invite; PLAN requires MFA within the last 15 minutes for user and role management.

Fix, commit `0949e93`: `@UseGuards(RequireStepUpGuard)` on the route, as on invite, revoke, remove and transfer.

Tests (real HTTP through the Nest application, valid CSRF and origin):

- `members.integration.test.ts`: a session with no stamp and one with a 16-minute-old stamp get 403 `/problems/step-up-required` and leave the membership `active`, the target's session live and `member.disable` audit empty; a fresh stamp still disables (200, status `disabled`).
- `rbac-real-routes.integration.test.ts` (the real-route matrix): every product route is classified as step-up required or exempt with a reason; the classification is compared with the guards Nest reads from the controller metadata; each of the 11 sensitive routes refuses a session with no stamp and one with a stale stamp with 403 step-up-required.
- Before the fix: 5 of the new assertions failed (200 instead of 403; the guard missing on disable). After: pass.
- Official `mutation_check.py` over `members.controller.ts`: KILLED (`EV-P06-092-mutation-disable-guard.json`).

Route audit against PLAN "MFA within the last 15 minutes" (user and role management, support-access grants): the 11 routes in `STEP_UP_REQUIRED` are guarded; the exempt ones are `POST /api/auth/step-up` (it is how a stamp is obtained), `POST /api/auth/sign-out-others` (protective), `GET /api/auth/login` and `GET /api/auth/callback` (public entry points). `disable` was the only gap.

## Not shown

Integration connect or disconnect, data export, erasure, tenant termination and billing changes have no route yet and so are not covered. Provider-side MFA enforcement is not certified here. Independent re-review pending; nothing is VERIFIED. During the before-run the existing timing test "a waiter on the invitation lock judges expiry at its own lock time" failed once; it passed in the with-fix run and in the full gate.
