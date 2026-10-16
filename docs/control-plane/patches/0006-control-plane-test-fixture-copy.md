# 0006: bound the control-plane test fixture copy (proposal, not applied)

**Status:** revision 2, independently reviewed, applied by the founder with `git apply` on
`hardening/control-plane-fixture-copy-0006` (from `main` at `1ee4df5`).
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

## What it changes (revision 2, 2026-10-16)

1. `copytree(..., ignore=control_plane_only)`: the runtime trees `worktrees`, `node_modules`,
   `state` and `__pycache__` are skipped, and any other symlink in the source makes the fixture
   fail with `ValueError` instead of being followed or kept. The control plane tracks no symlinks.
2. `tearDown` → `addCleanup` in two test classes, so the temporary directory is removed even when
   `setUp` fails part-way.
3. New `.claude/tests/test_fixture_copy.py`: the copy excludes the four runtime trees (including a
   `node_modules` symlink inside one) while keeping configuration and hooks; a directory or file
   symlink is refused, nothing is copied through it and its target is unchanged; a failing `setUp`
   in either class removes its temporary directory.

No existing test or assertion changes and no guardrail behaviour changes; only the fixture copy
is bounded. `.claude/tests/` is not in `kit-manifest.json`, so the manifest needs no update.

### Why revision 1 was replaced

Revision 1 (on `main` at `1ee4df5`, patch sha256 `c592978c…b978c`, identical to the uncommitted
fix found in the 51 worktrees) copied with `symlinks=True`. That bounds the copy, but a symlink
kept in the fixture points at its original target, and the tamper tests then write through it:
`test_edited_kit_file_is_drift` appends to `hooks/git_guard.py`, `test_non_executable_hook_is_caught`
runs `chmod 0644` on `hooks/policy_guard.py`, and others rewrite `settings.json` and `gates.json`.
Reproduced in a scratch copy: with revision 1 a symlinked `hooks/policy_guard.py` left its external
target modified and mode `0644`; on `main` (symlinks followed) the target stayed unchanged.
Revision 1's test asserted that an absolute link to a directory outside the fixture is kept. No
symlink exists in `.claude/` today, so this was latent, not active.

## Verified (2026-10-16, scratch copies of `main` at `1ee4df5`; not gate evidence)

All runs used `git archive` copies of the tracked `.claude/`, `CLAUDE.md` and `PLAN.md` (1.2 MiB)
outside the repository, with `TMPDIR` in the same scratch area; nothing in the repository changed.

- The patch applies cleanly (`patch -p1 --dry-run`, then applied) to `main` at `1ee4df5`; the
  result is byte-identical to the files it was generated from.
- `control_plane_check.py` exits 0; the control-plane suite runs 81 tests (78 existing, unchanged,
  plus 3 new), all passing, in 22 s. The `control-plane-lint` commands from `gates.json` (ruff
  0.15.12 format and check, mypy 2.3.1 strict) pass on 27 files.
- Mutation check, each change made alone and every one detected by the new tests: no fix at all
  (`main`), symlink refusal removed, `worktrees` not excluded, `node_modules` not excluded, either
  class back on `tearDown`. Excluding `hooks` from the copy (a required directory) fails
  `test_clean_copy_passes` and five other tests, so over-exclusion cannot pass silently.
- Bounded reproduction: a fake `.claude/worktrees/fake/node_modules` symlink to a 16 MiB directory.
  Peak `TMPDIR` use during `ControlPlaneCheckTest`: `main` 17.3 MiB (the 16 MiB is copied through
  the link), revision 1 1.3 MiB, this revision 1.3 MiB. Nothing was left in `TMPDIR` afterwards.

Not established: the suite was not run inside the real repository with the patch applied (that
needs it in place), and not in CI.

## Applied (2026-10-16)

The founder applied this patch (sha256 `1add7d24…948eb`); the two test files are byte-identical
to the reviewed revision and no other path under `.claude/` changed. In the repository:

- `test_fixture_copy.py` alone: 3 tests pass; nothing left in the dedicated `TMPDIR`.
- `control_plane_check.py`: all nine checks OK, including `kit-manifest` (18 files).
- `gates.py run control-plane control-plane-lint`: PASS; 81 tests in 22.6 s, lint on 27 files.
  Fixture copies under `/tmp` peaked at 776 KiB; none were left; root and D: free space unchanged.

`addCleanup` removes the temporary directory when `setUp` fails, but not when the process is
killed: a killed or timed-out run still leaves its copy in `/tmp` until reboot. With the runtime
trees excluded, that copy is now under 1.5 MiB.

## Storage hazard (2026-10-16)

**Measured and reproducible:** one linked worktree is 550 MB on disk, but 3.2 GB when copied with
symlinks followed (`du -sLl --apparent-size`; pnpm's `node_modules` links are expanded). With the
51 worktrees still present, each `setUp` would write about 160 GB to `/tmp`; with the 168 of the
audit, over 500 GB. A killed run never reaches `tearDown`/`addCleanup`, so its
`/tmp/moin-cp-test-*` copy stays behind; `/tmp` is on the root filesystem and is emptied only at
boot.

**Observed:** the gate ran in 27 s on 2026-10-12/13 and timed out at 610 s on 2026-10-14 and twice
on 2026-10-16 (04:40 and 04:51 UTC), shortly before the WSL host disk filled. Storage recovered
after a WSL shutdown, `fstrim` and VHD compaction.

**Supported inference, not established:** that those interrupted runs wrote large copies into
`/tmp` and contributed to the host-disk exhaustion. No listing of `/tmp` from before the reboot
survives, so neither the copies' presence nor their share of the full disk can be confirmed.

Until the patch is applied, do not run the `control-plane` gate (`gates.py fast`/`full`) while
`.claude/worktrees/` holds worktrees with `node_modules`.

**Observed the same day:** after the founder removed the 51 worktrees, the **unmodified** gate
passed in 21.7 s (`.git/claude-evidence/20261016T162007Z-run.json`); sampled once a second, the
fixture copies in `/tmp` stayed under 1 MiB and root usage did not change. This strongly supports
the worktree copies as the cause of the timeouts. The patch is still needed to keep the gate
bounded when worktrees accumulate again.

## Apply (founder)

Protected paths change, so every step below is the founder's. Run from the canonical checkout.

1. Preconditions: clean tree; `git worktree list` shows one entry; `df -h / /mnt/d` recorded.
2. Branch from the commit that carries this revision, and check the patch:
   `git switch -c fix/cp-0006-fixture-copy <revision commit>`, then
   `sha256sum docs/control-plane/patches/0006-control-plane-test-fixture-copy.patch` must print
   `1add7d24d9a1458496f69a85f368560fc3f08a47bb95400b0b9bcd6d4b9948eb`.
3. Apply: `git apply --check` the patch, then `git apply` it. Exactly two paths change:
   `.claude/tests/test_control_plane.py` (modified) and `.claude/tests/test_fixture_copy.py` (new).
   No manifest update (`.claude/tests/` is not in `kit-manifest.json`).
4. Focused tests:
   `python3 -m unittest discover -s .claude/tests -t .claude/tests -p 'test_fixture_copy.py' -v`
   (3 tests), then `python3 .claude/bin/control_plane_check.py` and
   `python3 .claude/bin/gates.py run control-plane control-plane-lint` (81 tests).
5. Full gate: `python3 .claude/bin/gates.py full` (integration needs `pnpm dev:up` and the
   `TEST_*` values from `.env.example` exported; stop the stack afterwards).
6. Expected: the control-plane gate in about 22 s; no `/tmp/moin-cp-test-*` left afterwards; root
   and D: free space unchanged. A slow or growing run means something else is wrong: stop it.
7. Commit (`test(control-plane): bound the fixture copy and refuse symlinks`), push the branch,
   open a draft PR, request the independent review, and merge only after it.
