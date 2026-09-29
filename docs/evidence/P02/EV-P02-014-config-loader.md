# EV-P02-014: Zod configuration loader fails fast and never echoes a secret (INV-15)

| Field | Value |
|---|---|
| Evidence ID | EV-P02-014 |
| Item | P02.03.03 |
| Date (UTC) | 2026-09-28 12:29 UTC |
| Commit | `f3065928572a2c60d699f2fb26e1e60dec550be3` (working tree had uncommitted changes) |
| Environment | local (vitest 5.0.2) + arm64 container |
| Command / procedure | apps/server/src/config/env.ts validates the environment with Zod once, eagerly, before Nest is constructed. 7 tests pass, including: a missing required variable throws naming the variable; an unknown SERVER_ROLE is rejected; a port outside 1-65535 is rejected; IMAGE_DIGEST must be a sha256 digest (INV-17); a rejected DATABASE_URL containing a password puts neither the password nor the malformed value into the error; describeConfig() redacts every secret-bearing variable. In the container, starting without DATABASE_URL exits 1 with "DATABASE_URL: is missing" and the line "No value is shown above on purpose: these variables can carry credentials (INV-15)". |
| Result | PASS — 7/7. Zods own messages are replaced with shape-only descriptions for secret-bearing variables rather than trusting a library message not to echo a password. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
