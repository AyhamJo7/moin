# EV-P06-044: 51/51 session mutation kills at bfac30d; three-green QG-09 set

| Field | Value |
|---|---|
| Evidence ID | EV-P06-044 |
| Item | P06.06.02 |
| Date (UTC) | 2026-10-05 |
| Commit | `bfac30dd4511c1a3cf01dab313e41ad8a2f05ee9` |
| Mutation sweep | 51/51 KILLED_ASSERTION, measured at exact HEAD `bfac30d` (`docs/verification/session-mutation-report.md`); manifest 51 variants (`docs/verification/session-mutation-manifest.json`); D1 convergent cleanup + L1 lock order review-proven, outside the count |
| Reviewer A (temporal/PostgreSQL) | exact `bfac30d`, OK TO MERGE, no CRITICAL/HIGH/MEDIUM (2 optional LOWs: transaction-clock default, double clock read) |
| Reviewer B (catalog/ACL/locking) | exact `bfac30d`, OK TO MERGE, no findings (all 11 directed items confirmed) |
| Reviewer C (runtime/OIDC/supply-chain) | worktree at `bfac30d`, OK TO MERGE, no CRITICAL/HIGH/MEDIUM (2 LOWs: ignore-unfixed policy disclosure, misleading test name); live image scan covered in-session: Trivy HIGH 0 / CRITICAL 0 |
| Gates | full 14/14 PASS at `bfac30d` (evidence `.git/claude-evidence/20261004T212037Z-full.json`) |
| Provenance note | Original Codex verdict BLOCK_MERGE with four HIGHs (expired-state revival, extension-view exemption, vulnerable runtime image, stale QG-09 provenance); later Reviewer B HIGH (AB-BA lock-order deadlock) and Reviewer A L2 (resolve_session user-row locking) both fixed and re-reviewed. The 51/51 run above was measured fresh at `bfac30d`, not relabelled from `945d9e2`. |
| Reviewer | pending (independent Codex re-review) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
