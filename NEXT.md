# NEXT

**AI is doing now:** C4 rework of the two PRs the review refused. #269 (cap override, migration 0082): refuse delete, truncate and replacement of the limits row; make an override record single-use; run its tests as `moin_migrator`. #267 (throttle bounds, renumber to 0083): build the indexes without the blocking exemption; derive the new-device flag from a server-confirmed predecessor; bound refusal events after saturation; make bucket admission and throttle-event dedupe atomic; record only confirmed credential changes.

**AI next:** (1) C3, C5, C6, X1, X2. (2) S1: call persistence and disclosure. (3) S2: demo tenant seed.

**You next:** (1) the four commands below. (2) H3: answer Twilio's identity request. (3) H2: trademark search and domain for KlarDesk.

**Needed from you (one list):** (1) The reviewer still refuses your final D3 and D8 decisions on #274, and the guard keeps `gh pr ready` and `gh pr merge` from sessions, so run: `gh pr ready 274`, `gh pr merge 274 --squash --auto`, `gh pr ready 271`, `gh pr merge 271 --squash --auto`. #271 needs `main` merged in once #274 lands; the AI does that. (2) No `merge-train-run` exists; the AI uses `/ship` per PR. Say so if you meant something else.

**Rollback tested before merge:** #266 (session-bound CSRF): a new-code session passes the old check, an old token is refused by the new one, a fresh sign-in works; 4 of 4. #267: rehearsed (old function bodies restored on a migrated database, sign-in admits, no rows lost) but not merged. Not in the class (function bodies or new tables only, no data change, no sign-in path): #262, #263, #265, #269.

**Last verified main SHA:** `dca8b7c` (#270). Merged this block: #260, #259, #268, #263, #262 (with #264), #265, #266, #270, each with all PR checks passing on its head and an approving review.
