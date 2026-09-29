# EV-P04-008: Every one of the 12 DFD flows resolves to a subprocessor row with a region, or to the explicit internal list. NO DPA IS SIGNED: every status is NOT_REQUESTED

| Field | Value |
|---|---|
| Evidence ID | EV-P04-008 |
| Item | P04.10.04 |
| Date (UTC) | 2026-09-29 14:11 UTC |
| Commit | `252be53a87ba3c6406dc0141077442bfe94ac6bc` (working tree had uncommitted changes) |
| Environment | local, Node 24.21.0 |
| Command / procedure | node scripts/check-subprocessors.ts; pnpm vitest run --project unit scripts/check-subprocessors.test.ts |
| Result | 6 parties, all 12 flows accounted for; 8 tests passed |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
