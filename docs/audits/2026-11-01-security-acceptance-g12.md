# QG-09 security acceptance — Group 12: P06.13 cross-tenant suite v1, P06.13.05 release-blocking (EV-P06-059)

Reviewer: independent security reviewer (adversarial; mutation probes in a throwaway worktree)
Reviewed SHA: `3ac126e316c9ee1679bb6e637b2ab387443d0e38` (origin/main, detached worktree `/tmp/moin-review/wt-sec1012`)
Origin commits: d5815a3 (#48 suite), 1e2224a (#50 CI wiring)
DB: private compose project `claudesec1012`, postgres only (127.0.0.1:55432). Probes run as `moin_app` through the Nest app.
LG-P01 (PLAN L5660): "Cross-tenant suite pass with 100 % route coverage".

Implementing code:

- `apps/server/src/modules/xsuite/{inventory.ts,routes.ts,seed.ts,surface.ts,cross-tenant.integration.test.ts,routes.test.ts}`
- `.github/workflows/verify.yml:172-178,445-460`
- `package.json:40` (`xsuite:report`)

## CI evidence (exact SHA)

- `gh run list --branch main -L 8` shows the verify run 41299849665 on 3ac126e as success. All 9 jobs succeeded, including "integration tests (real postgres)" and "RLS catalog check". security-scan (41299849768), codeql and container-scan also succeeded on the same SHA.
- `gh run download 41299849665 -n xsuite-coverage` gives `xsuite.json` with `success: true`, 14 passed, 0 failed. Copy: `/tmp/moin-review/claude-sec12-run/ci-artifact/xsuite.json`.
- `gh api repos/AyhamJo7/moin/rules/branches/main` shows `verify`, `security-scan` and `container-scan` as required status checks. The policy is strict, ruleset 24193962 is `active`, and `bypass_actors` is `[]`.
- In `verify.yml`, `pnpm test:integration` and `pnpm xsuite:report` run without `continue-on-error`. The aggregator job fails on any non-`success` `needs` result, including skipped jobs.

## Verdict table

| Item                                                                                   | Verdict                    | Proof command + exit code                                                                                                                                                                                                                                                                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P06.13.05 suite release-blocking in CI; coverage report stored                         | CONFIRMED (with LOW notes) | CI evidence above. Locally: `node vitest run --project integration apps/server/src/modules/xsuite/ --reporter=json` exited 1 with 13/14 (`/tmp/moin-review/claude-sec12-run/xsuite.log`). The one failure is `/api/auth/login → 502` because this review stack has no Keycloak (CI starts one); it is environmental, and CI shows 14/14 on the same SHA. `node vitest run --project unit apps/server/src/modules/xsuite/` exited 0 with 1/1. | A failing xsuite does fail the required `verify` check, and no actor can bypass it. Two notes: the "coverage report" is vitest pass/fail JSON, not a route-coverage figure, and it is a 90-day CI artifact (L1). Being release-blocking guarantees only what the suite actually checks; see H1.                                                                                                                         |
| P06.13.02 route inventory from Nest metadata; A-with-B-ids per route; coverage = 100 % | NOT CONFIRMED              | Mutation A (`/tmp/moin-review/claude-sec12-probes/mutation-a.diff`): coverage test exited 0 and the unit suite exited 0 (`mutation-a.log`, `mutation-a-unit.log`). Mutation C2 (`mutation-c2.diff`): the full xsuite gave 13/14 passes, the same as baseline (`mutation-c2.log`). Sanity mutation B (a new route in a mounted controller) failed the coverage test, exit 1 (`mutation-b.log`).                                               | **H1.** Coverage is measured against an application built from a module list typed into the test, not against the production roots. Inventory rows that are not `tenant-id` run no generated probe.                                                                                                                                                                                                                     |
| P06.13.01 two fully populated tenants (every table)                                    | NOT CONFIRMED on main      | `psql` count of FORCE-RLS tables in a probe DB migrated to 0077: **55**. `seed.ts` inserts into 8 tenant tables plus `users`.                                                                                                                                                                                                                                                                                                                | **M1.** The claim was true at d5815a3 (9 tables). On main, 46 tenant tables (contacts, conversations, messages, calls, leads, knowledge_*, outbox, job_runs, sse_events, …) have no two-tenant rows in the harness, and nothing detects the drift.                                                                                                                                                                      |
| P06.13.03 DB-layer + job-layer suites wired                                            | PARTIAL (ledger agrees)    | xsuite DB block: 2/2 pass                                                                                                                                                                                                                                                                                                                                                                                                                    | The DB-layer probe covers 9 tables, and `packages/db/src/tenant-isolation.integration.test.ts` covers organisations, locations and memberships. The job half is still recorded BLOCKED on P06.03.03. Note that the xsuite header (`cross-tenant.integration.test.ts:11-15`) still says "no job envelope exists", which is stale on main: migration 0062 job envelope and the P08 `JobConsumerModule` (#245) both exist. |
| P06.13.04 SSE, cache keys, S3 prefixes                                                 | PARTIAL (ledger agrees)    | `surface.ts` 1/1 pass                                                                                                                                                                                                                                                                                                                                                                                                                        | The registry is negative only. The SSE tripwire is a substring match on `/events` or `/stream` in route paths (`surface.ts:52-54`). The `sse_events` table (migration 0068) already exists, so the surface the tripwire guards is half-built.                                                                                                                                                                           |

Counts: CONFIRMED 1 · PARTIAL 2 · NOT CONFIRMED 2.

## Findings

### HIGH

- **H1. The release-blocking "100 % route coverage" (LG-P01) cannot see new modules, and it counts inventory rows rather than executed probes. Tags: LG-P01, P06.13.02, INV-01/INV-02 gate integrity.**
  - **Cause 1: the route set comes from a hand-built app.** `cross-tenant.integration.test.ts:69-110` builds its app from a typed import list (`IdentityAccessModule, TenantPoolModule, HealthModule, VoiceModule, WorkModule, CallSimulatorModule`). The routes the product actually serves are those of `ApiRootModule` (`apps/server/src/roots/api-root.module.ts:23-34`) and `VoiceRootModule`. No test builds either root (`grep -rl ApiRootModule apps --include=*.test.ts` finds nothing).
  - **Cause 2: only `tenant-id` rows get a generated probe.** It is the only class the suite loops over (`:233`). Rows of class `tenant-list`, `tenant-create`, `public` or `signature` satisfy the coverage assertion without any probe. The existing probes for those classes are hand-written for fixed URLs (`:269-388`); `POST /api/auth/step-up` and `/sign-out-others` have none (EV-P06-076 M1).
  - **Exploit path.** The next feature module (P09 knowledge, P10 conversations, P13 inbox) is added to `ApiRootModule` with a route that reads by id outside `withTenant`, or through a DEFINER that takes an org argument. CI stays green, the coverage step reports 100 %, and the cross-tenant read ships.
  - **Proof, mutation A.** I added `ZzProbeModule` with `GET /api/zz-leak/:id` to `ApiRootModule`. The coverage test still passed (exit 0) and so did the whole server unit project (exit 0).
  - **Proof, mutation C2.** I added `GET /api/support/zzlist` plus an inventory row of class `tenant-list`. The full xsuite stayed at the baseline 13/14 passes (the 14th is the Keycloak-only test). The new route was never called.
  - **Failing-test sketch.**
    - (a) In the xsuite, build the app from `ApiRootModule` and `VoiceRootModule` with the existing provider overrides. Alternatively, assert that the set of `@Controller` classes reachable from the roots equals the set mounted in the test app, and that it equals every `*.controller.ts` in `apps/server/src`.
    - (b) Generate a probe for every inventory class: call each `tenant-list` and `tenant-create` row as A and assert none of B's seeded markers appear; call each `public` row unauthenticated.
    - (c) Re-run mutations A and C2. Both must now fail.
  - **Fix.** Derive the served route set from the production root modules. Make every inventory class drive a generated probe, and make an unknown class fail the suite.

### MEDIUM

- **M1. The two-tenant harness covers 9 of 55 FORCE-RLS tables. P06.13.01 ("every table") is false on main, and nothing detects the drift. Tag: P06.13.01, INV-01 test depth.**
  - Where: `seed.ts:9-11` and its inserts; the DB-layer block at `cross-tenant.integration.test.ts:521-707` hard-codes the 9 tables.
  - Today's actual exposure looks low. A static catalog query I ran shows all 55 tables carry the standard `organisation_id = app.current_org()` USING/WITH CHECK policy (the reviewed memberships extension excepted), and CI runs the RLS catalog job.
  - Fix: add an assertion that the set of seeded tables equals `select relname from pg_class where relforcerowsecurity`. Seed each table through a factory, and probe SELECT/UPDATE/DELETE as A on B's row for every table in a loop. Correct the P06.13.01 tick until that lands.
- **M2. The coverage evidence is not a coverage report. Tag: P06.13.05 "coverage report stored as evidence".**
  - `xsuite:report` stores vitest pass/fail JSON. It contains no inventory, no per-route probe outcome, and no coverage number. Combined with H1, "14 passed" cannot be read as "100 % of routes probed".
  - Fix: emit `{route, class, probed: true, status}` rows from the suite into the artifact, and fail if any row has `probed: false`.

### LOW

- **L1.** The CI artifact expires under the default retention of 90 days, while the EV records cite it as evidence. Store the JSON's SHA-256 and location in the EV record, or attach it to a release.
- **L2.** `routes.ts:210-219` rebuilds a route whose path extends a sibling route without a slash in the wrong shape: `GET /api/support/grants-zz` becomes `GET /api/support/grants/-zz` (see `mutation-c.log`). It fails closed: the route shows as unprobed or orphaned. When I inventoried the mis-built path for an id route (mutation D, `mutation-d.log`), the probe hit a non-existent URL. It was caught only because the Nest 404 body echoes the path, which contains B's id. For a `foreignId: 'user'` body-id route, nothing would catch it. Fix the joining rule and add a unit case for `grants` / `grants-zz`.
- **L3.** The xsuite header and the job-layer status text are stale on main (job envelope and consumer exist). Update them so P06.13.03 is re-evaluated against P06.03.03.
- **L4.** The SSE tripwire is a substring match on route paths (EV-P06-076 L1, re-confirmed). `sse_events` already exists.

## Remediation checklist

- [ ] H1: build the xsuite app from `ApiRootModule` + `VoiceRootModule` (or assert controller-set equality against both roots and the filesystem), and generate a probe for every inventory class. Regression: mutations A and C2 must fail the suite.
- [ ] M1: assert seeded tables = all FORCE-RLS tables, seed all 55, and loop the A-on-B probes. Correct the P06.13.01 ledger tick until then.
- [ ] M2: emit a per-route probe report as the `xsuite-coverage` artifact, and fail on any unprobed row.
- [ ] L1: record the artifact digest in the EV record.
- [ ] L2: fix radix reconstruction for prefix-extending siblings, with a unit test.
- [ ] L3: refresh the job-layer status text.
- [ ] L4: detect SSE by content type or route metadata.

VERDICT: REQUEST_CHANGES
