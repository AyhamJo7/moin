# EV-P06-083: QG-09 S7 slices 1 and 2 GREEN: 0032 containment plus disableAccount service plus M2 callback race owner tests; CI 16 of 16; triple review OK

| Field | Value |
|---|---|
| Evidence ID | EV-P06-083 |
| Item | P06.09.02 |
| Date (UTC) | 2026-10-10 00:19 UTC |
| Commit | `300a716aed7911bfc45c19b20683f2b983b1ba4c` |
| Environment | CI |
| Command / procedure | vitest recovery plus catalog plus CI integration |
| Result | GREEN CI 16 of 16 |
| CI run / artifact | pending |
| Reviewer | gemini-3.8-flash invariant security architecture OK |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What changed (branch fix/qg09-s7-recovery vs main 4db4eba)

- Migration 0032: GUC-bound tenant check in `revoke_member_sessions` (forged-org
  refusal) + correlation forwarding; digest re-pin verified.
- `MemberQueries.disableAccount` service (arch-M1): disable txn orchestration moved
  out of RecoveryController; guards + parsing stay on routes.
- M2 regression: disabled-callback mints nothing, sign-in race revoked + audited,
  last-owner disable fails closed.
- Remaining §7 (L-gaps + M3 EV-P06-055 re-record) follows as slice 3.

## Verification state

- CI 16/16 green on PR75 head 300a716 (485 integration incl. new tests).
- Triple review (invariant + security + architecture) OK via review pane.
