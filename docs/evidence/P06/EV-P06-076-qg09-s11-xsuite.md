# EV-P06-076: QG-09 §11 xsuite+CI review (gemini static): OK TO MERGE; M1 inventory-vs-probes gap, L1/L2; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-076 |
| Item | P06.13.05 |
| Date (UTC) | 2026-10-09 |
| Commit | `d2f26360cb7607fa6b1cfdb6996f138f03015119` (review base `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by gemini-3.8-flash (review pane) of the §11 merge range (`d5815a3` xsuite v1 + `1e2224a` CI wiring): `apps/server/src/modules/xsuite/inventory.ts`, `surface.ts`, `cross-tenant.integration.test.ts`, `.github/workflows/verify.yml:160-180`. Each cited line re-verified by orchestrator direct read below. No fix implemented. |
| Result | OK TO MERGE (reviewer verdict — distinct from founder acceptance; founder verdict PENDING). No HIGH. Open findings below, all STATIC/UNVERIFIED. |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | gemini-3.8-flash static (security+architecture); founder verdict PENDING |

## Review target SHAs

`d5815a3` feat(xsuite): cross-tenant security suite v1 (#48) and `1e2224a` chore(ci): wire
xsuite coverage report (#50), as merged on `origin/main` (base EV-P06-059).

## Findings (severity-indexed; all STATIC)

- **M1 (MEDIUM, sec): tenant-list routes classified in inventory but without dedicated A-with-B-ids probes.** `inventory.ts:44-45` classes `POST /api/auth/step-up` and `POST /api/auth/sign-out-others` as `tenant-list` (own-session acting), but the probe file exercises them only via session minting (`cross-tenant.integration.test.ts:118` fresh `step_up_at` helper) — no cross-tenant-id probe asserts a step-up for tenant A's session cannot touch tenant B state. Verified: inventory lines 44-45 present; no `tenant-list` probe block found in the test file. Suite still fails closed (own-session binding), but the class claim exceeds probe coverage. Proposed: add tenant-list A-with-B-ids probes or reclassify with rationale.
- **L1 (LOW, arch): SSE negative tripwire relies on path substring matching.** `surface.ts:52-54` asserts no route path includes `/events` or `/stream`. Verified: `line.includes('/events') || line.includes('/stream')`. A future SSE endpoint under a different path (e.g. `/api/updates`) lands without tripping. Proposed: also assert on response content-type `text/event-stream` or a route-metadata tag.
- **L2 (LOW, arch): xsuite integration file executes twice in CI.** `verify.yml` runs `pnpm test:integration` (which includes `*.integration.test.ts`, hence the xsuite file) and then `pnpm xsuite:report` (same file again for the JSON report). Verified: `test:integration` line ~167 immediately followed by `xsuite:report` line ~169, then artifact upload. Harmless (ephemeral DBs) but doubles the longest test file. Proposed: JSON reporter on the main run, or exclude xsuite from `test:integration`.

Passes (sound, no finding): per-table DB isolation with 0-row foreign reads, 404-without-leak on A-with-B-ids HTTP probes, bidirectional live-router inventory parity, DEFINER/catalog pins, release-blocking `xsuite:report` gate with artifact.

## Disposition

None fixed in this change (documentation task only). Founder verdict PENDING for §11. OK TO MERGE is the reviewer's static verdict, not founder acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
