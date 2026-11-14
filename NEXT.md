# NEXT

**Handoff (2026-11-14).** Merged: #272 `7a7201d`, #273 `352c9a0`. Stay on `chore/owner-overhaul` in the main checkout (branches from `main` put the old guard back on disk); edit other branches in `~/worktrees/moin/`.

**AI is doing now:** C4, #260: fix the two MEDIUM review notes in the test (roll back in `finally`; compare expiry in the database), merge `origin/main` into the branch, wait for CI, `/ship 260`. Then #259, #268, #262, #263, #265, #264, #266, #267, #269, #270, each updated with `main` first (a ruleset keeps the up-to-date rule on).

**AI next:** (1) C5, C6. (2) S1: call persistence and disclosure. (3) S2: demo tenant seed.

**You next:** (1) the decision under "Blocked on you". (2) H3: Twilio identity request. (3) H2: trademark search and domain.

**Blocked on you:** the independent review refused #274 twice (roadmap, operating model) and will refuse #271 on the same grounds: it reads D2 (no new evidence records), D3 (session merges identity and migration PRs before 2026-11-29, one reviewer instead of the QG-09 three), D8 (conditional container scan) and "up-to-date rule off" as loosening `PLAN.md` gates QG-09, QG-03 and P02.06.03. Choose: (a) amend those `PLAN.md` gates yourself and merge #274 and #271 by hand, or (b) keep the gates and tell the AI to rewrite D2, D3, D8 and C3 to match.

**Rollback tested before merge:** none merged yet. Candidates: #262, #264, #265, #266, #267, #269.

**Last verified main SHA:** `352c9a0` (#273; all PR checks passed on head `647d840`, 2026-11-14).
