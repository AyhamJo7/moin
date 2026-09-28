# EV-P02-036: The licence check is proven to reject what it claims to reject

| Field | Value |
|---|---|
| Evidence ID | EV-P02-036 |
| Item | P02.08.04 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | node scripts/check-licences.ts --fixture agpl -> exit 1 ("the network clause reaches software offered over a network"); --fixture sspl -> exit 1 ("not an open-source licence"); --fixture gpl -> exit 1 ("strong copyleft"); --fixture unknown -> exit 1 ("the licence cannot be determined, so its obligations cannot be met"). The real tree passes: exit 0. The unit suite additionally asserts that a disjunction containing an allowed term passes, that a conjunction containing a refused term fails, and that each refusal explains why rather than only that it refused. |
| Result | PASS — all four controls reject, the real tree passes. A licence check nobody has watched refuse anything is indistinguishable from one that allows everything, which is what these fixtures exist to rule out. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
