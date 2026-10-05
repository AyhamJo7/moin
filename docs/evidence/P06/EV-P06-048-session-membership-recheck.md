# EV-P06-048: per-request session validity and membership re-check; single DEFINER lookup; GET-only 30s cache

| Field | Value |
|---|---|
| Evidence ID | EV-P06-048 |
| Item | P06.06.03 |
| Date (UTC) | 2026-10-05 |
| Commit | `0eed7ad` (implementation HEAD; governance record follows separately) |
| Environment | local |
| Command / procedure | Migration `0013` (`memberships` tenant table, FORCE RLS, scoped lookup policy) + `0014` (`app.resolve_request_context` DEFINER, canonical lock order, DB clock, marker GUC set/reset); guard + interceptor + tenant pool (api-only); suites: session-membership 9/9, tenant-isolation, rls-catalog 43/43, identity-store, readiness-identity; `gates.py fast` 7/7 |
| Result | READY_FOR_REVIEW — every request re-checks session + active membership in one DEFINER call (zero rows → 401; several → 401 ambiguous); GET-only ≤30 s cache (injected clock, lookup-count proven), mutations always fresh; FS-16 disable/remove fails next request; no org id from caller (INV-02); `moin_identity` gains no table grant; voice/worker/migrate graphs untouched |
| QG-09 | Three-green set at exact `1169972`, re-confirmed at `83e7e42` (boundary-fix scope: TenantQueries wrapper + probe DI rewrite, all else byte-identical): security OK TO MERGE (1 carried LOW: guarded-200 Cache-Control), architecture OK TO MERGE (H2 accepted per PLAN 30 s ceiling, M1 P06.07 follow-up), invariant OK TO MERGE (I2 atomic-slide follow-up P06.07+) |
| Security-reviewer | exact `1169972675554930bfc6aa5df7a6bcfc19dbd083`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/security-reviewer-1169972.md` |
| Architecture-reviewer | exact `1169972675554930bfc6aa5df7a6bcfc19dbd083`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-1169972.md` |
| Invariant-reviewer | exact `1169972675554930bfc6aa5df7a6bcfc19dbd083`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-1169972.md` |
| Security-reviewer (boundary fix) | exact `83e7e424f349daea7996bad00015abb61ce9aa73`, OK TO MERGE, no new findings. Artifact: `docs/evidence/P06/reviews/security-reviewer-83e7e42.md` |
| Codex BLOCK_MERGE repair | HIGH-1 (0012 immutability restored + byte-identity upgrade regression, mutation-proven) and HIGH-2 (slide folded into DEFINER, single-call service, min(30s, idle, absolute) triple-deadline cache, time-aware unit pins) verified closed by all three reviewers below |
| Security-reviewer (repair) | exact `9f5da5ee58bab4bafcc0274223ad46c7aef23009`, OK TO MERGE (1 LOW: global guard registration). Artifact: `docs/evidence/P06/reviews/security-reviewer-9f5da5e.md` |
| Architecture-reviewer (boundary fix) | exact `83e7e424f349daea7996bad00015abb61ce9aa73`, OK TO MERGE (2 LOWs at production wiring). Artifact: `docs/evidence/P06/reviews/architecture-reviewer-83e7e42.md` |
| Architecture-reviewer (repair) | exact `9f5da5ee58bab4bafcc0274223ad46c7aef23009`, OK TO MERGE, no open findings. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-9f5da5e.md` |
| Invariant-reviewer (boundary fix) | exact `83e7e424f349daea7996bad00015abb61ce9aa73`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-83e7e42.md` |
| Invariant-reviewer (repair) | exact `9f5da5ee58bab4bafcc0274223ad46c7aef23009`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-9f5da5e.md` |
| Codex BLOCK_MERGE repair (membership-lock stale clock) | `v_now` sampled only after family/session/user/membership locks; slide + verdict share post-lock clock; digest re-pinned `2476c022`; MWAIT1 (table-level lock past real deadline, mutation-proven 1-vs-0) + WAIT9 variant; 55/55 sweep at `0eed7ad` |
| Security-reviewer (membership lock) | exact `0eed7adb2737419243dce702babce0a6cb5d9f7b`, OK TO MERGE (2 LOWs). Artifact: `docs/evidence/P06/reviews/security-reviewer-0eed7ad.md` |
| Architecture-reviewer (membership lock) | exact `0eed7adb2737419243dce702babce0a6cb5d9f7b`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-0eed7ad.md` |
| Invariant-reviewer (membership lock) | exact `0eed7adb2737419243dce702babce0a6cb5d9f7b`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-0eed7ad.md` |
| Codex BLOCK_MERGE repair (RLS FOR UPDATE policy & row-lock retention) | `memberships_request_lookup_lock` policy `FOR UPDATE` added with scoped `USING` and tenant `WITH CHECK`; PostgreSQL evaluates UPDATE policies for `SELECT ... FOR SHARE`, retaining real row locks under FORCE RLS; MWAIT1 row-level gate restored; MWAIT2 (open lookup blocks racing disable via NOWAIT probe) + MWAIT3 (disable landing mid-wait observed) verified |
| Security-reviewer (row lock repair) | exact `dfdece53e1984218776856424b9426f1da3a0595`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/security-reviewer-dfdece5.md` |
| Architecture-reviewer (row lock repair) | exact `dfdece53e1984218776856424b9426f1da3a0595`, OK TO MERGE. Artifact: `docs/evidence/P06/reviews/architecture-reviewer-dfdece5.md` |
| Invariant-reviewer (row lock repair) | exact `dfdece53e1984218776856424b9426f1da3a0595`, OK TO MERGE, no bypass. Artifact: `docs/evidence/P06/reviews/invariant-reviewer-dfdece5.md` |
| Founder Full Quality Gate | 14/14 PASS at `91488cc` (evidence `20261005T142032Z-full.json`) |
| Residuals (P06.07+ backlog, non-blocking) | Guarded-200 Cache-Control header; global guard / route-inventory test; atomic slide+membership DEFINER call |
| Reviewer | pending (Codex re-review) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
