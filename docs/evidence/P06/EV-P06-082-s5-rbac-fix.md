# EV-P06-082: QG-09 S5 batch RED: 0029 effective-owner plus 0030 users-trigger plus may fail-closed plus session metadata plus matrix pins; static-clean; CI green pending

| Field | Value |
|---|---|
| Evidence ID | EV-P06-082 |
| Item | P06.07.05 |
| Date (UTC) | 2026-10-09 21:53 UTC |
| Commit | `a4167a71847b2c4bb2b93a35af8cf50abb2e4a31` |
| Environment | CI |
| Command / procedure | eslint prettier tsc check-migrations plus vitest roles and CI integration |
| Result | RED static-clean CI-green pending |
| CI run / artifact | pending |
| Reviewer | pending full PR review |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What changed (branch fix/qg09-s5-rbac vs main 750fe14)

- `may()` fail-closed for unknown roles (H4/M2 unit defect) + unit tests; roles unit 5/5.
- Session capability metadata on step-up/sign-out-others + matrix pins incl. AuthController rows (M2/M3); role loops scoped to role-scoped routes + per-session block.
- Migration 0029: effective-owner count (JOIN users) + cascade depth guard + digest re-pin; migration 0030: users-status trigger + catalog trigger block + digest re-pin.
- `owner-invariant` regression (H1 disable-user fails, keeper absorbs, cascade scope note, direct-delete fails).
- Remaining per triage: arch M1 service-layer support check, M4 owner-target pins, sec M1 owner-invite revoke — follow-up scope.

## Verification state

- Static clean: eslint + prettier + tsc + check-migrations (no findings).
- DB-green: CI integration on PR73 (rerun pending Docker rate-limit recovery).
