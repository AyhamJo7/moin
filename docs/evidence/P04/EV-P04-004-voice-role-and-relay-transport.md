# EV-P04-004: The voice role answers a signed webhook with TwiML and serves the media socket; an unauthenticated socket is closed

| Field | Value |
|---|---|
| Evidence ID | EV-P04-004 |
| Item | P04.04.04 |
| Date (UTC) | 2026-09-29 14:11 UTC |
| Commit | `252be53a87ba3c6406dc0141077442bfe94ac6bc` (working tree had uncommitted changes) |
| Environment | local, Node 24.21.0 |
| Command / procedure | pnpm vitest run --project unit apps/server/src/modules/voice |
| Result | 40 passed, including two against a real listening server |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
