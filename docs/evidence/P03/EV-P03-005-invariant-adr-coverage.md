# EV-P03-005: Every invariant is covered by an ADR, or the register says which phase writes one

| Field | Value |
|---|---|
| Evidence ID | EV-P03-005 |
| Item | P03.01.05 |
| Date (UTC) | 2026-09-28 17:18 UTC |
| Commit | `90b3b4158bd11348b5048afff0034f0d290cebd5` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | The same script cross-checks PLAN.md INV-01 to INV-20 against the ADR set. First run: INV-09, INV-14 and INV-20 had no ADR. Rather than writing speculative ADRs, docs/architecture/invariant-enforcement.md records the whole mapping and accounts for those three explicitly: INV-09 belongs to ADR-0016 in P07 and INV-20 to ADR-0029 in P23, both of which depend on code that does not exist; INV-14 has no ADR BY DESIGN, because it is a product-scope constraint and no linter can tell whether a feature constitutes an excluded sensitive use — its control is the deferred-products list and review at each gate. The script reads that section, so an unexplained gap still fails. |
| Result | PASS — no invariant is unaccounted for, and the three without an ADR are recorded with the phase that writes one rather than being quietly excused. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
