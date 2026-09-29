# EV-P02-006: README and CONTRIBUTING written

| Field | Value |
|---|---|
| Evidence ID | EV-P02-006 |
| Item | P02.01.05 |
| Date (UTC) | 2026-09-28 11:40 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | README.md: purpose, status, document map, quickstart, repository layout, verification commands, privacy note. CONTRIBUTING.md: branch and commit conventions, PR and review rules incl. QG-09, the evidence rules and the no-fake-completion list, gate commands incl. mutation_check, test rules (real Postgres for RLS, standalone runs, synthetic data, flake policy) and the invariants most likely to be touched. Both link PLAN, ARCHITECTURE, SECURITY, the development docs and the evidence registry; PRIVACY.md and OPERATIONS.md are named as arriving with P16 and P15. Verified with pnpm exec prettier --check . (exit 0) and by following every relative link. |
| Result | PASS — both files present and internally consistent. The quickstart is independently re-verified end to end by P02.04.06 and P02.07.03; this item covers authorship only. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
