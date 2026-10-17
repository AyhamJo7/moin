# 0007: evidence ledger ID check in the local `docs-consistency` gate

**What:** `.claude/gates.json` → `docs-consistency` also runs `node scripts/check-ledger-ids.ts`.

**Why:** the same check now runs in CI (`verify.yml`, Documentation consistency). Without the local
twin, `gates full` can pass on a tree whose evidence registry carries a duplicate or dangling ID, and
the claim hook accepts that run as evidence. The check found one dangling row on `main` when it was
written (`EV-P09-015` linked to the pre-rename `EV-P09-014-…` file), fixed in the same pull request.

**Apply (founder):**

```bash
! git am docs/control-plane/patches/0007-ledger-ids-gate.patch
python3 .claude/bin/control_plane_check.py
```

Applies cleanly to `origin/main` at `21241ea` (checked with `git am --3way` in a scratch worktree).
Tightens a gate; no loosening.
