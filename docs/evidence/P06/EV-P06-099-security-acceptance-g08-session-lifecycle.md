# EV-P06-099: Group 8 security acceptance: P06.06.07 (session lifecycle: expired, idle and revoked sessions rejected, removed member's next write fails, CSRF-less POST rejected, fixation prevented by rotation) CONFIRMED by the independent reviewer on main 3ac126e; verdict APPROVE. Break attempts all held; three LOW notes (30 s warm-read window, test naming, FS-16 open-task unassignment) do not change the verdict. Source: docs/audits/2026-11-01-security-acceptance-g08.md.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-099 |
| Item | P06.06.07 |
| Date (UTC) | 2026-11-01 14:58 UTC |
| Commit | `3510fea208faac25e2a61dafe051ef0b8e208261` |
| Environment | docs-only; reviewed state main 3ac126e |
| Command / procedure | Reviewer's probes over real HTTP as moin_app and moin_identity; integration suites 86/86 exit 0 (his log claude-sec00-integration.log). |
| Result | CONFIRMED by the independent reviewer; nothing is VERIFIED. |
| CI run / artifact | pending |
| Reviewer | Independent security reviewer, adversarial, main 3ac126e, 2026-11-01 |

Sensitive material is stored by reference only (PLAN.md evidence rules).
