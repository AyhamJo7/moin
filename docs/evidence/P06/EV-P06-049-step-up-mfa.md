# EV-P06-049: step-up MFA (≤ 15 min) for sensitive actions; RFC 9457 challenge; 64/64 mutation kill

| Field | Value |
|---|---|
| Evidence ID | EV-P06-049 |
| Item | P06.06.04 |
| Date (UTC) | 2026-10-06 |
| Commit | `35046b1` (implementation candidate) |
| Environment | local |
| Command / procedure | Migration `0015` (`step_up_at` column, begin_sign_in overload, rotate/resolve step-up stamp); RequireStepUpGuard with RFC 9457 challenge; RequestContextService cached freshness bounded by 15-minute window; 64/64 session mutation sweep; `gates.py fast` 7/7 |
| Result | READY_FOR_REVIEW — sensitive actions require re-authentication if stamp > 15m; initial sign-in stamps session; step_up rotation updates stamp; other rotations preserve stamp; rolling-window deploy compatibility (INV-17) preserved; GET cache respects expiry |
| QG-09 | Three-green set at exact `35046b1`: security OK TO MERGE, architecture OK TO MERGE, invariant OK TO MERGE (NO BYPASS FOUND) |
| Security-reviewer | exact `35046b1b87dda2c8af8ccf4fefbe8e29d86b48df`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/security-reviewer-35046b1.md` |
| Architecture-reviewer | exact `35046b1b87dda2c8af8ccf4fefbe8e29d86b48df`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-35046b1.md` |
| Invariant-reviewer | exact `35046b1b87dda2c8af8ccf4fefbe8e29d86b48df`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-35046b1.md` |
| Session mutation sweep | 64/64 KILLED_ASSERTION (measured at `35046b1`, artifact `docs/verification/session-mutation-report.md`) |
| Founder Full Quality Gate | pending |
| Reviewer | pending adversarial review |

Sensitive material is stored by reference only (PLAN.md evidence rules).
