# NEXT

**AI is doing now:** C3: the image build and scan steps of `container-scan` run only when the image inputs change, both checks still reporting on every PR. Auto-merge and delete-branch-on-merge are already on; the up-to-date rule stays.

**AI next:** (1) C5, C6: prune merged branches, worktrees and stashes; delete dead shape helpers. (2) X3, X1, X2: review follow-ups (throttle, cross-tenant suite, identity). (3) S1: call persistence and disclosure, then S2: demo tenant seed.

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list):** nothing.

**Rollback tested before merge:** #266 (session-bound CSRF): a new-code session passes the old check, an old token is refused by the new one, a fresh sign-in works; 4 of 4. #267 (migration 0083, sign-in throttle): old function bodies restored on a migrated database, sign-in admits, events written, no row lost, bucket count still right; 1 of 1. Not in the class (function bodies or new tables only, no data change, no sign-in path): #262, #263, #265, #269.

**Last verified main SHA:** `8378549` (#267; all 20 PR checks passed on head `6b87bf7`, 2026-11-15). C1, C2 and C4 are done: #272, #273, #274, #271, #260, #259, #268, #263, #262 (with #264), #265, #266, #270, #269, #267 merged; #257, #261 closed.
