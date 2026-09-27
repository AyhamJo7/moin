---
mission: Build and prove the moin development control plane (CONTROL_PLANE_PLAN.md, approved 2026-09-27)
status: ready_for_review
mode: interactive
updated: 2026-09-27T23:40Z
next: founder runs the empty-HOME command (CONTROL_PLANE_REPORT.md §5) and the founder actions; then merge PR #1, then PR #2
---

# Control plane: progress ledger

Ledger for Phase B (implement) and Phase C (prove) of `CONTROL_PLANE_PLAN.md`. One row per item.
Evidence = command + exit code + commit SHA, or a file under `evidence/`. This is **not** PLAN.md's
`PROGRESS.md` (created by P02.01.04).

| # | Item | Status | Commit | Evidence | Next |
|---|---|---|---|---|---|
| 0 | Toolchain: Node 24.21.0 (nvm), Terraform 1.16.4 (`~/.local/bin`) | done | — (outside repo) | `nvm install 24.21.0` exit 0, "Checksums matched"; nvm default restored to 22.20.0 (`lts/*` would have moved every repo to 24); terraform zip `sha256sum -c` OK, `terraform -version` = v1.16.4 | — |
| 1 | Kit `--defer-to-repo` (D-07) + orphan false-positive fixes | done | kit `daa6a40`, `88fb3e4`, `6033c7b` | kit pytest 125/125, ruff + mypy clean; `~/.claude/settings.json` 7 kit hooks wired (backup `settings.json.before-defer-to-repo`); live `defer` entries in `evidence/live-interactive-hooks.jsonl` | — |
| 2 | PLAN.md baseline PR (D-01) | done | `db23310` on `docs/plan-baseline` | https://github.com/AyhamJo7/moin/pull/1 (sha256 identical to draft) | founder merges first |
| 3 | Branch, plan move, ledger, research + banner | done | `1400d37` | draft PR https://github.com/AyhamJo7/moin/pull/2 | — |
| 4 | Kit port (11 files verbatim) + manifest + ruff/mypy config | done | `551747d` | byte-compare assert in port script; mypy strict clean | — |
| 5 | policy_guard + shared policy JSON | done | `00fb8c3` | 22 tests OK (every policy example runs as a real `git commit -F`) | — |
| 6 | plan_section, evidence, control_plane_check + tests | done | `d89b114` | 34 tests OK incl. all 34 real phase anchors | — |
| 7 | session_bootstrap + format_on_edit + tests | done | `551f0a0` | suite 44 OK | — |
| 8 | Reviewers, /closure, 4 skills, 7 rules, cloud/setup.sh, gates.json stub, README, CLAUDE.md, settings.json | done | `c49980b` | control_plane_check found the missing exec bit on policy_guard.py (would have failed open) before exit 0; 57 tests OK; `gates fast` PASS, `gates full` FAIL at `workspace` by design | — |
| 8a | /mnt/c I/O error mid-session | resolved | — | recovered from transcripts, verified, re-copied from originals after the mount recovered | — |
| 9 | Phase C: live interactive session | done | `3daaf5c` | `evidence/live-interactive-hooks.jsonl`: 10 blocks through the repo hooks | — |
| 10 | Phase C: headless, real HOME, throwaway clone | done | `3daaf5c` | `evidence/cloud-sim/out-local-*/SUMMARY.md`: 10/10 guard cases blocked; ask → denied; Stop hook blocked "all gates are green" | — |
| 11 | Skill dry runs (worktree) | done | `f5377d4`, `db5efeb` | 3 defects found and fixed (skill preprocessing aborted headless runs; handoff resume prompt; personal /closure shadowing the repo copy, fixed upstream); artifacts in `evidence/skills/` | — |
| 12 | Reviewers on a planted canary (7 defects) | done | canary branch deleted | `evidence/reviewers/*-report.md`: 7/7 found; invariant-reviewer BYPASS FOUND | — |
| 13 | mutation_check live | done | `1540a7c`, `ca27f57` | two fixes, both KILLED (evidence `.git/claude-evidence/mutation/`) | — |
| 14 | Rules probe; cloud pins | done | (this commit) | db.md auto-loaded (headless, model-reported) and evidence.md auto-loaded in the live session (observed); pins + checksums resolve; container run BLOCKED (Docker socket missing) | Docker / cloud run |
| 15 | Empty-HOME headless run | BLOCKED (founder) | — | D-13: founder runs `run.sh empty-home` | founder |
| 16 | CONTROL_PLANE_REPORT.md | in progress | — | — | — |

