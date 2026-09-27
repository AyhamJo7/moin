---
mission: Build and prove the moin development control plane (CONTROL_PLANE_PLAN.md, approved 2026-09-27)
status: in_progress
mode: interactive
updated: 2026-09-27T21:45Z
next: port kit files verbatim + kit-manifest
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
| 3 | Branch, plan move, ledger, research + banner | done | (this commit) | — | — |
