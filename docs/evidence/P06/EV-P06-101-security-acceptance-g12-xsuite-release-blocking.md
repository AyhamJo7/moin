# EV-P06-101: Group 12 security acceptance: P06.13.05 (the cross-tenant suite is release-blocking in CI) CONFIRMED with LOW notes by the independent reviewer on main 3ac126e (verify run 41299849665 green; a failing xsuite fails the required verify check; no bypass actors). The report stored is vitest pass/fail JSON, not a coverage figure (M2); that and the route-coverage HIGH are addressed by the open fix PR #259. Not covered here: P06.13.01 and P06.13.02 NOT CONFIRMED, P06.13.03 and P06.13.04 PARTIAL. Source: docs/audits/2026-11-01-security-acceptance-g12.md.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-101 |
| Item | P06.13.05 |
| Date (UTC) | 2026-11-01 14:58 UTC |
| Commit | `3510fea208faac25e2a61dafe051ef0b8e208261` (the record was written while only docs/evidence/INDEX.md and earlier records of this batch differed from this commit) |
| Environment | docs-only; reviewed state main 3ac126e |
| Command / procedure | CI evidence of run 41299849665 and the reviewer's local xsuite run (13/14, the failure environmental: no Keycloak). |
| Result | CONFIRMED by the independent reviewer; nothing is VERIFIED. |
| CI run / artifact | pending |
| Reviewer | Independent security reviewer, adversarial, main 3ac126e, 2026-11-01 |

Sensitive material is stored by reference only (PLAN.md evidence rules).
