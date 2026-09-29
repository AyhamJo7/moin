# EV-P02-049: Four negative-control pull requests, each failing the job it was written for; one of them found a dead secret-scanning rule

| Field | Value |
|---|---|
| Evidence ID | EV-P02-049 |
| Item | P02.06.07 |
| Date (UTC) | 2026-09-29 18:17 UTC |
| Commit | `1f22cd4bd309c40b6dd0cc4e3a62a7935dc5d8a7` (working tree had uncommitted changes) |
| Environment | GitHub Actions, ubuntu-24.04 |
| Command / procedure | PR #20 lint error, #21 failing test, #22 vulnerable dependency, #23 fake secret — all draft, none merged |
| Result | #20 verify/static FAIL; #21 verify/unit FAIL; #22 audit + trivy fs + trivy image FAIL (three independent detections), verify PASS; #23 secret scan FAIL. All four BLOCKED by the ruleset. #23 exposed that the repository's own gitleaks rule had never fired — fixed in PR #24 with a self-test. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
