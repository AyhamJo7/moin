---
mission: Build and prove the moin development control plane (CONTROL_PLANE_PLAN.md, approved 2026-09-27)
status: in_progress
mode: interactive
updated: 2026-09-27T21:45Z
next: session_bootstrap, format_on_edit, agents, skills, rules, cloud script, CLAUDE.md, settings
---

# Control plane: progress ledger

Ledger for Phase B (implement) and Phase C (prove) of `CONTROL_PLANE_PLAN.md`. One row per item.
Evidence = command + exit code + commit SHA, or a file under `evidence/`. This is **not** PLAN.md's
`PROGRESS.md` (created by P02.01.04).

| # | Item | Status | Commit | Evidence | Next |
|---|---|---|---|---|---|
| 0 | Toolchain: Node 24.21.0 (nvm), Terraform 1.16.4 (`~/.local/bin`) | done | — (outside repo) | `nvm install 24.21.0` exit 0, "Checksums matched"; nvm default restored to 22.20.0 (`lts/*` would have moved every repo to 24); terraform zip `sha256sum -c` OK, `terraform -version` = v1.16.4 | — |
| 1 | Kit `--defer-to-repo` (D-07) + orphan false-positive fix | done | kit `daa6a40`, `88fb3e4` | kit pytest 124/124 (14 new), ruff + mypy clean; `~/.claude/settings.json` 7 kit hooks wired (backup `settings.json.before-defer-to-repo`) | live one-copy check in Phase C |
| 2 | PLAN.md baseline PR (D-01) | done | `db23310` on `docs/plan-baseline` | https://github.com/AyhamJo7/moin/pull/1 (sha256 identical to draft) | founder merges first |
| 3 | Branch, plan move, ledger, research + banner | done | `1400d37` | draft PR https://github.com/AyhamJo7/moin/pull/2 | — |
| 4 | Kit port (11 files verbatim) + manifest + ruff/mypy config | done | `551747d` | byte-compare assert in port script; `ruff format --check` 11 unchanged; mypy strict clean | — |
| 5 | policy_guard + shared policy JSON (A-22 incl. Claude-Session / claude.ai links / Co-Authored-By; INV-15/16; QG-05; push forms) | done | (this commit) | `python3 -m unittest discover -s .claude/tests -t .claude/tests` → 22 tests OK (≈150 subtests: every block/allow example in the policy JSON runs as a real `git commit -F`); ruff + mypy strict clean | live trigger in Phase C |
| 6 | plan_section, evidence, control_plane_check + tests | done | (this commit) | 34 tests OK (plan_section: synthetic plan + all 34 real phase anchors; evidence: greenfield no-op/refusal, numbering, from-gates, STALE/MISSING/DUPLICATE); ruff + mypy strict clean (19 files) | control_plane_check goes green once the remaining files land |
