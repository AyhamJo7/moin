# EV-P07-001: kernel-value-objects-plus-25-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-001 |
| Item | P07.01.01 |
| Date (UTC) | 2026-10-10 05:17 UTC |
| Commit | `084436f8aa112f1e683d249919fcdcd89ba1ac92` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (control-plane 24.0 s, control-plane-lint 1.4 s, conventions 0.1 s, docs-consistency 1.6 s, format 4.6 s, lint 3.4 s, boundaries 1.1 s, typecheck 1.2 s, unit 6.2 s, integration 20.1 s, migrations 0.1 s, build 5.9 s, licences 0.4 s, secret-scan 1.3 s; evidence `20261010T053621Z-full.json`) |
| Result | PASS |
| CI run / artifact | PR #80: `1b0150f` 16/16 SUCCESS; `a019871` 16/16 SUCCESS; this round-2 fix head CI pending at push time |
| Reviewer | codex BLOCK round 1 on `1b0150f` (6 must-fix, all fixed in `e70d519`); codex FINAL re-review BLOCK on `a019871` (2 residuals: overbroad +49555 blocks callable Northeim 05551; exponent spelling breaks decimal-split rounding) — both fixed in this round (prefix dropped + 05551 neighbour test; exponent fast path + 1e-7 regression) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
