# EV-P02-003: CODEOWNERS, PR template and issue templates in place

| Field | Value |
|---|---|
| Evidence ID | EV-P02-003 |
| Item | P02.01.02 |
| Date (UTC) | 2026-09-28 11:40 UTC |
| Commit | `766f53e2804a53cf0930e0047669c1cd8abb66e8` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | Files created and inspected: .github/CODEOWNERS (catch-all plus explicit owners for the control plane, PLAN/BLUEPRINT/PROGRESS, docs/evidence, packages/db, the identity-access / tenancy / audit / privacy / billing modules and infrastructure); .github/pull_request_template.md carrying all seven P02.01.02 fields (what/why, risk, tests, evidence IDs, docs, migration/rollback, privacy impact) plus a QG-09 trigger checkbox; .github/ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}. The PR template was exercised end to end by PR #3, which fills every field. |
| Result | PASS — PR #3 (https://github.com/AyhamJo7/moin/pull/3) was authored against the template with every field filled, so the template is exercised rather than merely present. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
