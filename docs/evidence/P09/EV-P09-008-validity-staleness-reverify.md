# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep (ROUND-1 review fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 19:40 UTC (ROUND-1 fix; initial 17:29 UTC) |
| Commit | `TBD (this push)` — prior pin `d48cc28` (superseded by ROUND-1) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T174503Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (32.5 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #101 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #101 after ROUND-1 fix) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | ROUND-1 (codex BLOCK on d48cc28, 5 findings): P1-1 queue never cleared — approveKnowledgeVersion now deletes the queue row alongside clearing suspended (re-approval resets the lifecycle); new re-queue test proves sweep re-tasks after re-due. P1-2 restricted served until sweep — getLiveVersion suppresses overdue-restricted INLINE (same decided_at + reverify_after predicate, now-injectable param); test pins null with no sweep run. P1-3 overdue sensitive FAQ spoken — matchCards excludes overdue-sensitive (escalation); public/internal serve stale=true; new test pins null. P2-1 FAQ no fallback — omitted reverifyAfterDays → 90d card default (explicit null still opts out); default/null test pins both. P2-2 bare task_id — no composite FK possible (tasks PKs on bare id); documented in 0057 + application-level test (task ids resolve in-tenant, invisible cross-tenant). Also: queue grant widened to DELETE (approval path deletes rows — permission-denied caught by suite); getLiveVersion now takes optional now param (default = current behaviour, no caller changes). Tests 11 green 3x (33/33 with knowledge + faq + approval). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
