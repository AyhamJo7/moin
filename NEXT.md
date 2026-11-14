# NEXT

**AI is doing now:** C4. Merged: #260, #259, #268, #263, #262 (with #264 folded in). Left, in order: #265 (renumber its migration to 0081), #266, #267, #269, #270. Each: worktree under `~/worktrees/moin/`, bring `main` in, drop ledger files, CI, `/ship`.

**AI next:** (1) C3, C5, C6, X1, X2. (2) S1: call persistence and disclosure. (3) S2: demo tenant seed.

**You next:** (1) the four commands below. (2) H3: answer Twilio's identity request. (3) H2: trademark search and domain for KlarDesk.

**Needed from you (one list):** (1) The reviewer still refuses your final D3 and D8 decisions on #274, and the guard keeps `gh pr ready` and `gh pr merge` from sessions, so run: `gh pr ready 274`, `gh pr merge 274 --squash --auto`, `gh pr ready 271`, `gh pr merge 271 --squash --auto`. The AI keeps both branches up to date with `main`. (2) No `merge-train-run` exists; the AI uses `/ship` per PR. Say so if you meant something else.

**Rollback tested before merge** (migrations that change data; identity changes that could lock you out): none needed so far. #262 (migrations 0079, 0080) replaces one function body, changes no data and no sign-in path; #263 has no migration. Still to judge: #265, #266, #267, #269.

**Last verified main SHA:** `b059ada` (#262; all PR checks passed on head `f76f083`, 2026-11-14).
