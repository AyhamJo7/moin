# 0006: bound the control-plane test fixture copy (proposal, not applied)

**Status:** proposal for the founder to review and apply. Nothing here is applied by this PR.
Patch file: `0006-control-plane-test-fixture-copy.patch` (next to this file).

## Why

`clone_control_plane()` in `.claude/tests/test_control_plane.py` copies the whole `.claude/`
directory into a temporary fixture for every test case. `.claude/` also holds runtime trees:
`worktrees/` (on 2026-10-16 it held 168 linked worktrees, about 14 GB with their `node_modules`),
`state/` and `node_modules` symlinks. `shutil.copytree` follows symlinks by default, so each test
setUp could copy gigabytes. The fixture only needs the control-plane files.

The same uncommitted fix was found, byte-identical, in 51 linked worktrees during the 2026-10-16
cleanup (diff md5 `aef0856798639ea1b0a170c6441c0101`, new-file md5
`cb39b62fe69db0b102f8de13b81e62e7`). It was never committed. The archived copy is at
`~/archives/moin/2026-10-16/uncommitted/` (outside the repository).

## What it changes

1. `copytree(..., symlinks=True, ignore=ignore_patterns("__pycache__", "state", "worktrees",
   "node_modules"))`: runtime trees are excluded, and symlinks are copied as links instead of
   being followed.
2. `tearDown` → `addCleanup` in two test classes, so the temporary directory is removed even when
   `setUp` fails part-way.
3. New `.claude/tests/test_fixture_copy.py`: proves the copy excludes `worktrees`,
   `node_modules`, `state` and `__pycache__` while keeping configuration and hooks.

No assertion is weakened and no guardrail behaviour changes; only the fixture copy is bounded.

## Verified so far

- The patch applies cleanly to `main` at `993ea23` (`patch -p1 --dry-run` on a copy); the
  resulting `test_fixture_copy.py` is byte-identical to the archived file.
- The control-plane test suite was **not** run with the patch applied (that needs it in place).
- Diagnostic, 2026-10-16 after the host-disk incident (not gate evidence; nothing on disk changed):
  `ControlPlaneCheckTest` with this patch's `copytree` arguments substituted in memory ran
  9 tests in 0.5 s, all passing; the other 69 control-plane tests (no full-tree copy) passed
  unmodified in 19.6 s. No control-plane defect remains besides the fixture copy itself.

## Storage hazard (measured 2026-10-16)

The unbounded copy is a disk-exhaustion hazard, not only a timeout:

- One linked worktree is 550 MB on disk, but 3.2 GB when copied with symlinks followed
  (`du -sLl --apparent-size`; pnpm's `node_modules` links are expanded). With the 51 worktrees
  still present, each `setUp` would write about 160 GB to `/tmp`; with the 168 of the audit,
  over 500 GB.
- The gate timed out at 610 s on 2026-10-14 and on 2026-10-16 (it ran in 27 s on 2026-10-12/13).
  A killed run never reaches `tearDown`/`addCleanup`, so its `/tmp/moin-cp-test-*` copy stays
  behind. `/tmp` is on the root filesystem and is emptied only at boot.
- Two such runs (04:40 and 04:51 UTC) preceded the 2026-10-16 WSL host-disk exhaustion; the space
  was released at the next boot. No `/tmp` listing from before the reboot survives, so this is the
  probable mechanism, not a proven one.

Until the patch is applied, do not run the `control-plane` gate (`gates.py fast`/`full`) while
`.claude/worktrees/` holds worktrees with `node_modules`.

Confirmed the same day: after the founder removed the 51 worktrees, the **unmodified** gate passed
in 21.7 s (`.git/claude-evidence/20261016T162007Z-run.json`); the fixture copies in `/tmp` stayed
under 1 MiB and root usage did not change. The worktree population was sufficient to cause the
timeouts and the amplification. The patch is still needed to keep the gate bounded when worktrees
accumulate again.

## Apply (founder)

```bash
git apply docs/control-plane/patches/0006-control-plane-test-fixture-copy.patch
python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests
```
