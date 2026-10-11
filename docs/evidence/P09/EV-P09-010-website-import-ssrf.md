# EV-P09-010: Website import with SSRF suite: verified domains, guarded fetch, drafts only, injection flags (ROUND-8 record fix)

| Field | Value |
|---|---|
| Evidence ID | EV-P09-010 |
| Item | P09.08.05 |
| Date (UTC) | 2026-10-11 23:55 UTC (ROUND-8 record-only; ROUND-7 23:35 UTC; ROUND-6 23:20 UTC; ROUND-5 23:00 UTC; ROUND-4 22:45 UTC; ROUND-3 22:30 UTC; ROUND-2 22:00 UTC; ROUND-1 21:30 UTC; initial 20:50 UTC) |
| Commit | `ae4460e` (ROUND-8 record-only incl. EV + ledger; code unchanged since `de1e726`) |
| Environment | local |
| Command / procedure | `gates.py full` 14/14 PASS (artifact `20261011T225729Z-full.json`): control-plane, control-plane-lint, conventions, docs-consistency, format, lint, boundaries, typecheck, unit, integration (24.5 s), migrations, build, licences, secret-scan. Test env vars exported from the example env file (no worktree secrets file; INV-15); pinned Node 24.21.0 / pnpm 10.34.5 on PATH. |
| Result | PASS |
| CI run / artifact | PR #103 (draft, this push): CI pending at push time |
| Reviewer | pending (re-review requested on PR #103 after ROUND-8 record fix) |
| Mutation | Semantic KILLED at HEAD `de1e726` — record on disk: `claude-evidence/mutation/20261011T225701Z.json` (+ `latest.json`): private-address predicate in resolvePinned disabled → exactly the 3 private-address tests FAIL (rebinding + literal + robots-pinned) while the other 14 pass; with-fix 17/17 PASS; restored byte-identical (clean tree verified). |
| Design notes | ROUND-8 (codex BLOCK on de1e726, EVIDENCE-ONLY mutation-record gap — invariant/security/architecture OK): no code changes. Prior rounds pasted the semantic run into EV prose without persisting the JSON record (harness yields file-absence verdicts on untracked fix files, so the record is written manually in the harness schema + tails). Re-ran the predicate-kill at current HEAD and persisted the record; reviewer reads it from disk. Full ROUND-6 design unchanged — see prior record. Tests 17 green 3x (33/33 with knowledge + faq). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
