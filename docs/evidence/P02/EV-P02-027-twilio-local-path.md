# EV-P02-027: Twilio development path documented as developer-only

| Field | Value |
|---|---|
| Evidence ID | EV-P02-027 |
| Item | P02.04.04 |
| Date (UTC) | 2026-09-28 13:10 UTC |
| Commit | `adbe336fea37b1cf83e27b27cd928044e117afe4` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/development/twilio-local.md records six rules: sandbox numbers only; the tunnel is developer-local and never part of a deployed environment; signature validation stays on in every environment; the tunnel is closed when work stops; credentials come from the environment and are Secrets Manager ARNs in deployed environments; recordings stay off (INV-07). It states that the protocol simulator in packages/telephony is the primary development path precisely because it needs no tunnel, account or network, and that the tunnel covers only what the simulator cannot reach. |
| Result | PASS. Deliberately names no tunnel provider and gives no command: choosing one needs a Twilio account (EXT-10), a founder action, and documenting a specific tool before that decision would be guessing. P11 records the choice in an ADR alongside the account setup. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
