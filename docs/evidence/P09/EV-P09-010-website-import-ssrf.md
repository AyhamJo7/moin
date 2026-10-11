# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-9 harness verdict)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 23:50 UTC (ROUND-9 fix; ROUND-8 record-only; ROUND-7 23:35 UTC; ROUND-6 23:20 UTC; ROUND-5 23:00 UTC; ROUND-4 22:45 UTC; ROUND-3 22:30 UTC; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `accdf7a` (ROUND-9 fix incl. EV + ledger; prior pin `b2db61d` superseded) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T230940Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (25.8 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-9 fix) |
| Mutation | Harness `KILLED_ASSERTION` 1/1 at HEAD `b2db61d` — report on disk: `docs/verification/import-mutation-report.md` (+ manifest + results JSON): variant M1 (private-address check removed from resolvePinned) killed by `import-ssrf > dns-rebinding second address refused` (baseline PASSED, mutant rejected on assertion, 2s/2s). The manual semantic record is superseded — the reviewer reads the harness verdict from disk. |
| Design notes | ROUND-9 (codex BLOCK on b2db61d, harness-verdict gap): the manual semantic record (mode semantic-manual) is NOT harness KILLED_ASSERTION per docs/verification/README.md — and the claim behind it was wrong (fix files ARE tracked at de1e726, so the real harness runs fine). Ran the real `mutation-sweep.ts` with a proper manifest (tracked fix-paths, evidenceTest identity): KILLED_ASSERTION 1/1. Manifest + report + results JSON committed alongside. No code changes. Tests 17 green 3x (33/33 with knowledge + faq). This record cites the artifact recorded on the pushed HEAD (matches_tree true). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
