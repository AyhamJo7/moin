---
name: next
description: Continue the work. Reads NEXT.md and carries on with the item it names, then the AI queue in ROADMAP.md.
---

1. Read `NEXT.md`. If it holds a handoff note, follow it first.
2. `git fetch --prune origin`, then `git status -sb`. Work from `origin/main`; if a branch for
   the current item exists, continue on it.
3. Take the item under "AI is doing now". If it is finished or blocked on the founder, take the
   first item of the AI queue in `ROADMAP.md` whose dependencies are met. Items that share a
   letter in the Par column may run in parallel, one worktree each.
4. Work it as `OPERATING.md` describes: branch, draft PR at the first commit, test first, local
   `gates.py full`, `/ship <pr>`.
5. In the same PR: mark the item in `ROADMAP.md` (move it out of the queue into section 2 when
   merged) and rewrite `NEXT.md` in its fixed shape (doing now, next three, you next three,
   blocked on you, last verified main SHA; at most 15 lines).
6. Carry on with the next item. Stop only for a founder-only item with no independent work left,
   or when context is heavy: then write the handoff into `NEXT.md`, commit, push, and say so.

Report at a milestone: three lines of what changed, the merged SHAs, `NEXT.md` verbatim.
