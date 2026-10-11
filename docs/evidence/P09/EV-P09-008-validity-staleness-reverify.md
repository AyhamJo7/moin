# EV-P09-008: Validity, staleness and re-verification: expiry enforced, overdue-sensitive suspension, flagged stale, idempotent sweep

| Field | Value |
|---|---|
| Evidence ID | EV-P09-008 |
| Item | P09.06.03 |
| Date (UTC) | 2026-10-11 17:29 UTC |
| Commit | `178f42c` (impl `fa4dfb1` + ledger; branch `feat/p09-06-staleness`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T172803Z-full.json`): control-plane 31.6 s, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration 23.4 s, migrations, build, licences, secret-scan. One transient support-suite timing failure on the first full run (unrelated files, green standalone + on re-run). |
| Result | PASS |
| CI run / artifact | PR #101 (draft): CI pending at push time |
| Reviewer | pending (review requested on PR #101) |
| Mutation | `mutation_check.py` KILLED (staleness suite fails without fix, passes with it; fix restored byte-identical) |
| Design notes | 0057 additive only (reverify_after nullable, suspended default false, queue table + RLS/FORCE, allowlist rows). Expiry enforced in getLiveVersion + matchCards (expired never served). Overdue-restricted suspends (escalation; re-approval lifts); overdue public/internal serves with stale flag (FaqAnswer.stale). Category defaults menu 30d / hours + prices 90d / fallback 90d at creation; explicit days override; NULL = no deadline. Sweep excludes handled rows (suspended + queued) so it converges; per-item idempotency via queue UNIQUE + task key reverify:itemId. Audit markers only (version_no). Inventory rows for 5 new columns. Tests 7 green 3x (23/23 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
