# NEXT

**AI is doing now:** C1: #271 (lean control plane) on auto-merge, the last part. Then C4 rework. #269 (cap override, migration 0082): refuse delete, truncate and replacement of the limits row; make an override record single-use; run its tests as `moin_migrator`. #267 (throttle bounds, renumber to 0083): build the indexes without the blocking exemption; derive the new-device flag from a server-confirmed predecessor; bound refusal events after saturation; make bucket admission and throttle-event dedupe atomic; record only confirmed credential changes.

**AI next:** (1) C3, C5, C6, X1, X2. (2) S1: call persistence and disclosure. (3) S2: demo tenant seed.

**You next:** (1) H3: answer Twilio's identity request. (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list):** nothing. Merges go through `/ship`, one PR at a time (founder, 2026-11-14).

**Rollback tested before merge:** #266 (session-bound CSRF): a new-code session passes the old check, an old token is refused by the new one, a fresh sign-in works; 4 of 4. #267: rehearsed (old function bodies restored on a migrated database, sign-in admits, no rows lost) but not merged. Not in the class (function bodies or new tables only, no data change, no sign-in path): #262, #263, #265, #269.

**Last verified main SHA:** `ba86e18` (#274). Merged so far: #272, #273, #260, #259, #268, #263, #262 (with #264), #265, #266, #270, #274.
