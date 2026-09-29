# EV-P02-020: Module-boundary rules proven by trees that violate them

| Field | Value |
|---|---|
| Evidence ID | EV-P02-020 |
| Item | P02.02.07 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local (dependency-cruiser 18.4.0, vitest 5.0.2) |
| Command / procedure | The rules are anchored to real repository paths, so each case builds a throwaway tree at exactly those paths in a temp directory and cruises it with the repositorys own .dependency-cruiser.cjs. 9 cases pass: a module reaching into another modules domain layer is rejected; into its infrastructure layer is rejected; using another modules published application service is allowed; a non-platform module importing the database client is rejected (only-platform-opens-transactions) while the platform module doing the same is allowed; a shared package importing an application is rejected; the web app importing server internals is rejected; a cycle between modules is rejected; and a boundary breach smuggled through require() instead of import is still caught. |
| Result | PASS — 9/9. This closes the partial scope recorded in EV-P02-011 and EV-P02-001, which could only verify the boundary rules as configuration because apps/server/src/modules did not exist when they were written. The positive/negative pair on the same import (platform allowed, work rejected) is what shows the rule discriminates rather than always firing. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
