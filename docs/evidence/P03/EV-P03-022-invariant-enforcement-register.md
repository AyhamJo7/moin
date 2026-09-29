# EV-P03-022: Every invariant mapped to its enforcement, phase and owner

| Field | Value |
|---|---|
| Evidence ID | EV-P03-022 |
| Item | P03.08.01 |
| Date (UTC) | 2026-09-28 23:20 UTC |
| Commit | `2f6106c4727cae31a44685bf5b2524a0f85356ef` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/architecture/invariant-enforcement.md maps all twenty invariants to the lint rule, CI check, runtime assertion, test or alarm that holds each true, the ADR behind it, the phase where that enforcement lands, and an owner. The phase column is the honest part: a future phase means the invariant is NOT enforced yet, stated rather than implied. Three are live today (INV-12 through the allowlist redactor, INV-17 through the image assertion and migration check, INV-15 partially). |
| Result | PASS. The owner column reads "founder" on every row today, which is accurate rather than aspirational — the column exists because that will not stay true, and an invariant whose owner is "the team" has no owner. INV-14 is the one row with no automated enforcement at all, and it says so explicitly: it is a product-scope constraint, and its control is the deferred-products list plus review at each gate. Recording "no automated check is possible" is more useful than inventing one that would be theatre. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
