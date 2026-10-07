# EV-P06-049: step-up MFA (≤ 15 min) for sensitive actions; 64/64 mutation kill

| Field | Value |
|---|---|
| Evidence ID | EV-P06-049 |
| Item | P06.06.04 |
| Date (UTC) | 2026-10-06 |
| Commit | `81da2e4` (evidence HEAD; step-up code identical to `8ae542f` sweep HEAD — plus dep override and evidence rows since) |
| Environment | local |
| Command / procedure | Migration `0015` (`step_up_at` + `step_up_session_id` columns, redefined session functions with 6-arg rolling-window overload, DB-clock `step_up_fresh` verdict); subject binding (`identity.subject` vs owner subject); `RequireStepUpGuard` (403, single-resolve off `sessionContext`); `POST /api/auth/step-up` membership-gated; provider `max_age=0` + `auth_time` freshness; 64/64 session mutation sweep; `gates.py fast` 7/7 |
| Result | READY_FOR_REVIEW — sensitive actions require fresh MFA proof within 15 min; initial sign-in stamps; step_up rotation refreshes, privilege_change inherits; pre-0015 NULL stamps fail closed; rolling-window deploy keeps old hosts signing in (contracted in 0016); GET cache bounded by stamp expiry, unstamped never cached |
| QG-09 | Three-green set at `b126af4` (code-identical to reviewed `8ae542f`/`d1d5c5f` modulo progress rows): security OK TO MERGE, architecture OK TO MERGE, invariant NO BYPASS FOUND |
| Security-reviewer | exact `b126af4e6fc97d5302d07570035ca0d36dca19da`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/security-reviewer-b126af4.md` (prior rounds at `779f146`, `d1d5c5f` closed H1/H2/M2) |
| Architecture-reviewer | exact `b126af4e6fc97d5302d07570035ca0d36dca19da`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-b126af4.md` (prior H1/M1/L1/L2 verified closed) |
| Invariant-reviewer | exact `b126af4e6fc97d5302d07570035ca0d36dca19da`, NO BYPASS FOUND. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-b126af4.md` (SHA log-derived, content-verified — reviewer sandbox has no shell) |
| Session mutation sweep | 64/64 KILLED_ASSERTION (measured at `8ae542f`, artifact `docs/verification/session-mutation-report.md`; includes SU1–SU9) |
| Founder Full Quality Gate | 14/14 PASS at `3f68fc5` (evidence 20261006T014632Z-full.json, founder-run with ephemeral fixture env; dep override at `81da2e4` re-verified by `pnpm audit --prod` clean + web typecheck) |
| Reviewer | pending adversarial review |

Sensitive material is stored by reference only (PLAN.md evidence rules).
