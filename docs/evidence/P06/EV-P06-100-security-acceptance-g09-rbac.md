# EV-P06-100: Group 9 security acceptance: P06.07.02 (declarative guards plus service checks plus RLS), P06.07.03 (cross-tenant and not-permitted both 404) and P06.07.04 (last-owner protection, held under 10 iterations of each race) CONFIRMED by the independent reviewer on main 3ac126e. Not covered by this record: P06.07.01 PARTIAL (M1: an admin can invite billing_admin and integration_admin) and P06.07.05 PARTIAL (M4: the matrix is generated from a hand-kept controller list). M2 (transfer versus remove deadlock) and M3 (EV-P06-053 mutants B1/B2 survive on main) are recorded as findings. Source: docs/audits/2026-11-01-security-acceptance-g09.md.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-100 |
| Item | P06.07.02 |
| Date (UTC) | 2026-11-01 14:58 UTC |
| Commit | `3510fea208faac25e2a61dafe051ef0b8e208261` (the record was written while only docs/evidence/INDEX.md and earlier records of this batch differed from this commit) |
| Environment | docs-only; reviewed state main 3ac126e |
| Command / procedure | Reviewer's probes and mutants B1', B2', B3, B4, B5 KILLED (his logs under claude-sec03-rbac). |
| Result | CONFIRMED by the independent reviewer; nothing is VERIFIED. |
| CI run / artifact | pending |
| Reviewer | Independent security reviewer, adversarial, main 3ac126e, 2026-11-01 |

Sensitive material is stored by reference only (PLAN.md evidence rules).
