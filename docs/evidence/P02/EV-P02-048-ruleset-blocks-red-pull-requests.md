# EV-P02-048: Four pull requests with a failing required check are all reported BLOCKED by GitHub; the no-push half is derived from the ruleset, not tested

| Field | Value |
|---|---|
| Evidence ID | EV-P02-048 |
| Item | P02.01.07 |
| Date (UTC) | 2026-09-29 18:17 UTC |
| Commit | `1f22cd4bd309c40b6dd0cc4e3a62a7935dc5d8a7` (working tree had uncommitted changes) |
| Environment | github.com/AyhamJo7/moin |
| Command / procedure | gh pr view 20 21 22 23 --json mergeStateStatus |
| Result | all four BLOCKED. Direct-push rejection is NOT empirically tested: a session may not push to main (CLAUDE.md §8). It follows from non_fast_forward + pull_request required + zero bypass actors in the export under EV-P02-047, and the founder can confirm it in one command. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
