# EV-P06-046: CWAIT1/RWAIT2/RWAIT1 repaired to genuine stale-clock races; WAIT5 placement mutant; 54/54 at 316caa6; three-green set

| Field | Value |
|---|---|
| Evidence ID | EV-P06-046 |
| Item | P06.06.01, P06.06.02 |
| Date (UTC) | 2026-10-05 |
| Commit | `316caa67ead125c6b8d1b87dfe6f2a8868a5f869` (clean tree) |
| Environment | local |
| Command / procedure | `node scripts/mutation-sweep.ts --manifest docs/verification/session-mutation-manifest.json --report docs/verification/session-mutation-report.md` at exact HEAD `316caa6` (TEST_* database URLs + TEST_OIDC_ISSUER_URL exported, postgres + oidc up); every target proved equal to HEAD blob before/after; manifest 54 variants; identity integration suite 20 consecutive runs x 58/58 |
| Result | PASS — 54/54 KILLED_ASSERTION, 0 survived, 0 infra failures, clean restoration; identity suite 20/20 x 58 passed |
| Independent BLOCK_MERGE repair | Independent review at `3c2ad79` blocked on 3 MEDIUMs (CWAIT1 vacuous, RWAIT2 invalid-at-start, RWAIT1 CHECK flake + WAIT5 skew-not-placement). All repaired test-only; migration `0012` blob identical `043cd28..316caa6` (`bb9f418c…`); production diff empty. CWAIT1 genuineness manually proven (pre-claim mutant returns 1 row vs 0). |
| Security-reviewer | exact `316caa67ead125c6b8d1b87dfe6f2a8868a5f869`, OK TO MERGE, no CRITICAL/HIGH/MEDIUM; 2 optional LOWs (absolute-path isolation variant; pid-scoped lock polling). Artifact: `docs/evidence/P06/reviews/security-reviewer-316caa6.md` |
| Architecture-reviewer | exact `316caa67ead125c6b8d1b87dfe6f2a8868a5f869`, OK TO MERGE, no findings. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-316caa6.md` |
| Invariant-reviewer | exact `316caa67ead125c6b8d1b87dfe6f2a8868a5f869`, OK TO MERGE, no bypass, no findings. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-316caa6.md` |
| Gates | Founder-run `gates.py full` 14/14 PASS (evidence `.git/claude-evidence/<ts>-full.json`; run by the founder with ephemeral local-development fixture env). Post-review delta `316caa6..<evidence-HEAD>` is evidence/governance/reporting only. |
| Reviewer | pending (independent re-review) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
