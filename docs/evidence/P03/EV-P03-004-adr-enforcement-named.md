# EV-P03-004: Every ADR names the automated check that enforces it

| Field | Value |
|---|---|
| Evidence ID | EV-P03-004 |
| Item | P03.01.04 |
| Date (UTC) | 2026-09-28 17:18 UTC |
| Commit | `90b3b4158bd11348b5048afff0034f0d290cebd5` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | scripts/check-adr-coverage.ts parses every ADR and fails if its Verification section does not name at least one enforcement in a table. Run on first use it failed on four ADRs written in P02 (0002, 0034, 0044, 0045), which had no Verification section at all; each was given one naming real checks that already run. |
| Result | PASS — 17 ADRs, every one names an enforcement. The check found the gap rather than a reader noticing it, which is the point of making it mechanical. |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan success https://github.com/AyhamJo7/moin/actions/runs/36457405770; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36574586847; security-scan success https://github.com/AyhamJo7/moin/actions/runs/36457405878; verify success https://github.com/AyhamJo7/moin/actions/runs/36457405843 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
