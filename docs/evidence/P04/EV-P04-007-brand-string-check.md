# EV-P04-007: ADR-0034 enforced by a check rather than by review; it reads the brand name from the configuration it protects

| Field | Value |
|---|---|
| Evidence ID | EV-P04-007 |
| Item | P04.07.04 |
| Date (UTC) | 2026-09-29 14:11 UTC |
| Commit | `252be53a87ba3c6406dc0141077442bfe94ac6bc` (working tree had uncommitted changes) |
| Environment | local, Node 24.21.0 |
| Command / procedure | node scripts/check-brand-strings.ts; pnpm vitest run --project unit scripts/check-brand-strings.test.ts |
| Result | clean on the tree; 11 tests passed including seeded violations |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
