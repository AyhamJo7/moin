# EV-P03-019: Every personal-data flow maps to an inventory category and a subprocessor entry

| Field | Value |
|---|---|
| Evidence ID | EV-P03-019 |
| Item | P03.04.03 |
| Date (UTC) | 2026-09-28 23:16 UTC |
| Commit | `b9f29969dc70690009fb41b4b18b001b64166a1d` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | node scripts/check-dfd-coverage.ts -> exit 0, "12 flows, each with an inventory category and a guard". The check parses the flow table, and fails on a flow with no category, a flow with no guard, or a category the inventory does not define. 4 unit tests. |
| Result | PASS — and it found three real gaps in the diagram first draft, which is the argument for having it rather than reading the table: two flows were classified as "all", which is not a classification (a flow touching everything must say what everything is, or the subprocessor register cannot be derived from it); one named a category the inventory does not define; and one carried a credential with no classification at all, now stated as "not personal data", which is a classification too as long as it says so. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
