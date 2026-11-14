---
name: ship
description: Merge a pull request the automated way. CI must pass on the exact head SHA and the independent review must approve that SHA. Takes a PR number, or several in merge order.
---

For each PR number, in the order given:

1. `gh pr view <pr> --json headRefOid,baseRefName,isDraft,mergeable`. A stacked PR whose parent
   was just merged: `gh pr edit <pr> --base main` first.
2. `gh pr checks <pr> --watch --fail-fast` (one call, no polling). A failed check: read
   `gh run view <run> --log-failed`, fix on the branch, push, start again at step 1.
3. `python3 .claude/bin/merge_gate.py <pr>`. It re-checks CI on the head SHA, runs the
   independent review on an isolated snapshot of that SHA, and squash-merges pinned to it.
   A CRITICAL or HIGH finding: fix it with a test (mutation-checked on control paths), push,
   start again at step 1. After two rounds of disagreement on the same finding, write it into
   `NEXT.md` under "Blocked on you" and go on with the next PR.
4. Quote the merge commit SHA and the check results. `git fetch origin` before the next PR.

Never merge with `gh pr merge` directly, never mark a red PR ready, never bypass a required
check.
