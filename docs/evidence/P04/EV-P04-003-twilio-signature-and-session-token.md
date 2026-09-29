# EV-P04-003: Signature validation matches Twilio's published vector; the media socket is bound by a single-use 60s hashed token

| Field | Value |
|---|---|
| Evidence ID | EV-P04-003 |
| Item | P04.04.03 |
| Date (UTC) | 2026-09-29 14:11 UTC |
| Commit | `252be53a87ba3c6406dc0141077442bfe94ac6bc` (working tree had uncommitted changes) |
| Environment | local, Node 24.21.0 |
| Command / procedure | pnpm vitest run --project unit packages/telephony/src/signature packages/telephony/src/session |
| Result | 32 passed |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
