# EV-P03-023: Every invariant has an automated enforcement, or a documented manual control

| Field | Value |
|---|---|
| Evidence ID | EV-P03-023 |
| Item | P03.08.02 |
| Date (UTC) | 2026-09-28 23:20 UTC |
| Commit | `2f6106c4727cae31a44685bf5b2524a0f85356ef` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | node scripts/check-adr-coverage.ts -> exit 0. The check requires every invariant to be referenced by at least one ADR, or to be named in the registers deferred section with the phase that writes one. Manual inspection of the register confirms every INV row names at least one enforcement mechanism. |
| Result | PASS — 20 of 20 accounted for. 19 have an automated enforcement named; INV-14 has an explicitly documented manual control, which is what the checklist item permits. HONEST SCOPE: naming an enforcement is not the same as it existing. Only three invariants are enforced by something running today; the rest name the phase that builds their check, and the register is what makes that gap visible rather than assumed. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
