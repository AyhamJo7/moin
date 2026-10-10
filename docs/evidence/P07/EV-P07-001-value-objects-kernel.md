# EV-P07-001: kernel-value-objects-plus-22-tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-001 |
| Item | P07.01.01 |
| Date (UTC) | 2026-10-10 05:17 UTC |
| Commit | `084436f8aa112f1e683d249919fcdcd89ba1ac92` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (control-plane 24.0 s, control-plane-lint 1.4 s, conventions 0.1 s, docs-consistency 1.6 s, format 4.6 s, lint 3.4 s, boundaries 1.1 s, typecheck 1.2 s, unit 6.2 s, integration 20.1 s, migrations 0.1 s, build 5.9 s, licences 0.4 s, secret-scan 1.3 s; evidence `20261010T053621Z-full.json`) |
| Result | PASS |
| CI run / artifact | PR #80: prior head `1b0150f` 16/16 SUCCESS; round-1 fix head `e70d519` local full gates 14/14 PASS, CI running at push time |
| Reviewer | codex BLOCK round 1 on `1b0150f` (6 must-fix: precise reserved ranges + 0800/069-neighbour tests; PII-free errors; PLZ 01xxx comment + 01067 test; decimal-string cent rounding + 1.005 regression; generated phone properties + reserved-range property; fast-check to devDependencies; this CI/Reviewer staleness) — all fixed in this round |

Sensitive material is stored by reference only (PLAN.md evidence rules).
