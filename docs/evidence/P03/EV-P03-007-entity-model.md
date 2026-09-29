# EV-P03-007: Entity and relationship model per module, extending the blueprint

| Field | Value |
|---|---|
| Evidence ID | EV-P03-007 |
| Item | P03.02.02 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/architecture/domain-model.md lists the entities of every module from PLAN Domain Boundaries, extending BLUEPRINT.md L1028-1087, and records the relationships that carry rules rather than every relationship. Verified mechanically by scripts/check-domain-coverage.ts, which extracts entity names from the blueprint range and asserts each appears in the model or the glossary, matching code term, snake_case table name or plural. |
| Result | PASS — 26 blueprint entities, all accounted for, 5 explicitly deferred (Document and Invoice to P34, Workflow and WorkflowRun to P10, Consent to P16). The deferred list is in the script rather than implied, because a deferred entity is a decision and an absent one is an oversight, and the two must not look the same. The check also found a bug in itself on first run: naive pluralisation reported retention_policy as unmapped when the table is retention_policies — a false positive, which in a coverage check is worse than none because it teaches the reader to skim the output. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
