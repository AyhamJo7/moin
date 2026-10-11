# EV-P09-001: P09.01 knowledge model: items, guarded versions, approvals, 8 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P09-001 |
| Item | P09.01.04 |
| Date (UTC) | 2026-10-11 06:12 UTC |
| Commit | `d01c338` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261011T063723Z-full.json`, on this head — see that artifact for per-gate timings) |
| Result | PASS |
| CI run / artifact | PR #96 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #96) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/knowledge.integration.test.ts" --fix-paths packages/db/src/knowledge.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | ROUND-2 (2 HIGH + 2 MEDIUM): ledger-first flip (service inserts approval before UPDATE; versions trigger requires the ledger row — direct flip without approver dies); items forward-only (draft->approved->retired, no backward) + pointer item-match (cross-item approved version still raises); location RESTRICT (SET NULL dead text — FK actions fire row triggers, probe-verified — refused honestly as 23503); approval-FK mismatch test present (fresh-draft isolation). ROUND-1 (4 HIGH + 1 MEDIUM): location_id composite FK to locations (cross-tenant 23503 test); versions/items lifecycle triggers at the DB boundary (ENABLE ALWAYS; versions allow only the state-alone draft→approved flip, items allow pointer moves to approved versions + NULL-on-retire only, retire terminal — direct-update tests assert 42501 + content untouched); approvals item-scoped FK (org,item,version) so mismatches die as 23503; approve requires LATEST draft version_no (stale-draft test: v2 409s with v3 pending, then v3 approves); immutable wording corrected to guarded-write everywhere. 0052 three tables (items shell + versions history + approvals ledger), RLS+FORCE, composite FKs. Item lock serialises approves/retires (loser 409s). getLiveVersion reads the live pointer + approved state — drafts (NULL) and retired (cleared) serve nothing. Audit markers only (version_no/scope), never titles/bodies (INV-12). BR-095 metadata: source/location/category/validity/sensitivity/channels/version; Betriebsferien stay in P09.03 opening_exceptions, not the global file. Tests 8 (3x): draft-serves-nothing, approve→edit-keeps-old→approve-flips, illegal transitions, stale-draft, concurrent approve, DB-boundary bypass, state-regression + cross-item + approval-FK + location-RESTRICT, audit-content + RLS + location-FK + input rejection. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
