# .claude/: session tooling

How work flows is in `OPERATING.md`; why this directory is small is in
`docs/audits/2026-11-14-owner-audit/`. The previous control plane is at tag `pre-owner-overhaul`.

| Path                                                                                   | What                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `settings.json`                                                                        | permissions (deny rules for secrets, `main`, provider CLIs) and hook wiring                 |
| `hooks/policy_guard.py`                                                                | the few hard limits of `OPERATING.md`; `--self-test` runs its cases                         |
| `hooks/git_guard.py`                                                                   | blocks git that discards uncommitted work                                                   |
| `hooks/claim_check.py`, `stop_guard.py`, `stopfailure_checkpoint.py`                   | Stop hooks: claims need proof, stall detection, checkpoint on a usage limit                 |
| `hooks/session_context.py`, `session_bootstrap.py`, `worktree_context.py`, `_kit.py`   | session orientation and toolchain pin warnings                                              |
| `hooks/format_on_edit.py`, `ts_edit_check.py`                                          | prettier and typecheck on edited files                                                      |
| `bin/gates.py`, `gates.json`                                                           | local gates (`fast`, `full`); no Docker needed                                              |
| `bin/merge_gate.py`, `policy/merge-gate.json`                                          | `/ship`: CI on the head SHA plus an independent review, then a squash-merge pinned to it    |
| `bin/mutation_check.py`                                                                | proves a regression test fails without its fix                                              |
| `bin/plan_section.py`                                                                  | slices `PLAN.md` by item ID, heading or invariants                                          |
| `bin/evidence.py`                                                                      | reads the frozen `docs/evidence/` registry; no new records                                  |
| `policy/no-ai-mentions.json`                                                           | attribution patterns shared by the merge gate and `scripts/check-no-ai-mentions.ts` in CI   |
| `skills/next`, `preflight`, `ship`                                                     | continue the work, check the machine, merge a PR                                            |
| `agents/`, `rules/`                                                                    | read-only reviewers; path-scoped pointers                                                   |
| `cloud/setup.sh`                                                                       | tool pins for cloud sessions (not in use)                                                   |
| `tests/`                                                                               | `python3 -m unittest discover -s .claude/tests -t .claude/tests`                            |
