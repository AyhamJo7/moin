# EV-P02-034: Migration safety check with proven negative controls (QG-08, INV-17)

| Field | Value |
|---|---|
| Evidence ID | EV-P02-034 |
| Item | P02.06.04 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local (Node 24.21.0) |
| Command / procedure | scripts/check-migrations.ts enforces expand/contract and lock safety with nine rules. Destructive: drop-column, drop-table, rename, ADD COLUMN NOT NULL without DEFAULT, TRUNCATE. Locking: CREATE INDEX without CONCURRENTLY, validated FOREIGN KEY, validated CHECK, ALTER COLUMN TYPE. Ten fixtures in scripts/__fixtures__/migrations: six violate a rule and are all flagged; three are safe and none is flagged (an allowed exception with a stated reason, a file whose comment merely mentions DROP COLUMN, and CREATE INDEX CONCURRENTLY); one has an unordered filename and is flagged. Comments are stripped before matching, so the checker does not fire on its own documentation. 8 unit tests assert each rule, each online alternative, the comment case, both halves of the escape hatch, and that the repositorys real migrations pass. Wired into the verify workflow after the integration tests. |
| Result | PASS — 8/8, and the checker discriminates rather than always firing: six violating fixtures flagged, three safe ones not. The escape hatch requires a reason on the same line (`-- migration-check: allow drop-column because ...`); the same directive without a reason still fails, so it cannot become a reflex. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
