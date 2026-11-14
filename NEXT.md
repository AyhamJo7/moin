# NEXT

**AI is doing now:** C1: #274 (roadmap, operating model, founder amendment) and #271 (lean control plane) on GitHub auto-merge. C4 (#260 merged): #259, #268, #262, #263, #265, #264, #266, #267, #269, #270, each reviewed through `/ship`, stacks through `merge-train`.

**AI next:** (1) C3, C5, C6. (2) S1: call persistence and disclosure. (3) S2: demo tenant seed.

**You next:** (1) H3: answer Twilio's identity request (account reported suspended). (2) H2: trademark search and domain for KlarDesk. (3) H4: request Bedrock model access in eu-central-1.

**Needed from you (one list):** (1) The reviewer still refuses your final D3 and D8 decisions, and the guard keeps `gh pr ready` and `gh pr merge` from sessions, so run: `gh pr ready 274`, `gh pr merge 274 --squash --auto`, `gh pr ready 271`, `gh pr merge 271 --squash --auto`. The AI keeps both branches up to date with `main`. (2) No `merge-train-run` exists; the AI uses `/ship` per PR and the kit's `merge-train` for the two stacks. Say so if you meant something else.

**Rollback tested before merge** (migrations that change data; identity changes that could lock you out): none merged yet. Candidates in C4: #262, #264, #265, #266, #267, #269.

**Last verified main SHA:** `bf44c00` (#260; all PR checks passed on head `7e9c8ae`, 2026-11-14).
