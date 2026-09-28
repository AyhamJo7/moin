# EV-P03-011: Every blueprint entity maps to the model; no unmapped entity

| Field | Value |
|---|---|
| Evidence ID | EV-P03-011 |
| Item | P03.02.06 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | node scripts/check-domain-coverage.ts -> exit 0, "26 blueprint entities, all accounted for (5 explicitly deferred)". The check reads the blueprint range PLAN cites for this item rather than the whole file, extracts CamelCase entity names from its tree diagrams, and requires each to appear in the domain model or the glossary under its code term, table name or plural — or to be listed as deferred with the phase that builds it. |
| Result | PASS — 0 unmapped. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
