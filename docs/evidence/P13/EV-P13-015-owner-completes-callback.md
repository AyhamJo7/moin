# EV-P13-015: M2A: the owner completes a callback with Erledigt on Heute; the completion is versioned, audited as the owner's act and survives reload, API restart, concurrency and a replay of the original call

| Field | Value |
|---|---|
| Evidence ID | EV-P13-015 |
| Item | P13.03.02 |
| Date (UTC) | 2026-10-17 16:41 UTC |
| Commit | `ea78006c542a9fbdbc4e42432254bd419fefcb44` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 6.3 s); `pnpm lint` → pass (exit 0, 7.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 4.3 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 28.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.3 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

Mission M2A. Only the **Erledigt** part of P13.03.02 exists; P13.03.02 stays IN_PROGRESS and
nothing here is VERIFIED. P13.03.05 (every card action) is not delivered either.

**Path.** simulated call → `callback_acceptances` + callback task (M1) → `GET /api/today` (now
carries each task's `version`) → Heute callback card → **Erledigt** (client island) →
`POST /api/tasks/:id/complete {version}` with the session cookie, the echoed CSRF token and the
app's origin → `WorkQueries.complete` → `getTask` + `completeTask` (the existing P07.06 machine) in
one `withTenant` transaction as the signed-in member → `GET /api/tasks/:id` reads the result in any
status.

**Reused, not rebuilt.** `completeTask`/`setTaskStatus` (strict chain, version compare-and-hold, one
`task.status` audit event per move), `withTenant` (FORCE RLS, `actorId`/`correlationId` for the
audit), the session/membership, CSRF and throttle guards, the Today contract and page, the J3 lock
order. No migration, no new table, no second state machine.

**Behaviour.** Completing an `open` task is three guarded moves (version 1 → 4) and three audit
events, all as the owner, on one correlation id, with opaque status markers and no title. A stale
version, an illegal move (cancelled) or a lost race is 409 (`/problems/version-conflict`) and writes
nothing; another tenant's task and a missing task are the same 404; a malformed id is 404; a body
other than `{version}` is 400. Completing an already-done task with its current version is a 200
no-op (no audit). The **same request repeated** with the old version is a 409 by design
(compare-and-hold, not an idempotency key): one effect, and the card re-reads the page for any
outcome that may have changed something (success, conflict, missing, unknown) so the next click
carries the current version.

## Tests and what each proves

API (`owner-completes-callback.integration.test.ts`, real PostgreSQL as `moin_app`, real guards,
session from the real sign-in callback, fixture pool only reads back):

| Test | Business fact asserted |
| --- | --- |
| seen, completed with its version, recorded as the owner's act | Today lists it at version 1; 200 `{done, 4}`; row status/version/tenant/title/type; three `task.status` events with `actor_id` = the owner, one correlation id, markers 1,2,3, no title in the audit; audit count +3; task count and the `callback_acceptances` row unchanged; chain valid; gone from Today; `GET /api/tasks/:id` says done/4 |
| survives an API restart | a new Nest app on the same database: not in Today, task still done/4 |
| replay of the original call | replay answers `replayed: true` with the same task id; task row byte-identical, no new task, no audit row, still not in Today |
| stale version, then a repeat | 409 problem body; row open/1, no audit; first request lands, the identical repeat is 409 and adds no event |
| already done, current version | 200 with the same state; no audit change |
| cancelled | 409; stays cancelled/2; no audit |
| two owners, same version (6 rounds) | exactly one 200 and one 409 each round; done/4; exactly three events; chain valid |
| failure on the last rung (trigger) | 500 with no internal text; row open/1, zero events, audit count unchanged, still in Today; with the fault gone the same request completes |
| completions race with replays and fresh calls | no 5xx, no 40P01 text; every task done/4 with one acceptance; a later replay returns the same task and leaves the row identical; chain valid |
| other tenant | complete and read both 404, identical to a missing id, not in their Today; nothing audited in either tenant; malformed id 404 |
| no session / bad CSRF / foreign origin | 401 / 403 / 403 / 403; task and audit unchanged; unauthenticated read 401 |
| body | `{}`, string/zero/fractional version, extra `status`, extra `organisationId` are all 400 |
| Today version | `version` present and ≥ 1 in the contract |

Neighbours: the two task routes are in the cross-tenant inventory (tenant B's seeded task id gives
404 on both, id not echoed); the CSRF cookie/header names are pinned between the browser contract
and the API (identity module). Client logic (`complete-task.test.ts`, 12 cases): token read, request
shape, every status mapped, success claimed only for a `done` task of the id asked for, network loss
is "unknown", German sentences without codes, refresh rule.

Browser (`e2e/vertical-slice/today-callback.spec.ts`, Chromium, real Keycloak login, compiled API,
standalone owner app): the owner clicks Erledigt on the callback card; a double click sends exactly
one POST (delayed response, request counted); the live region says "Der Rückruf ist als erledigt
markiert."; the card leaves the list; the database holds done/4 with three events by one actor; the
card stays gone after reload, after an API restart and after the original call is simulated again
(same task id, no second task); axe passes with the button; no console error (a blocked script
would leave the button inert). A second window completes first, then the stale window's click gets
"Diese Aufgabe wurde inzwischen geändert …", no "erledigt markiert", the card disappears, and the
database still shows one completion (three events).

## Mutation evidence

Standard `mutation_check.py --fix-ref 5bda9f3` (reverse-applies that commit's change to one file,
runs the new API suite): `work-queries.ts`, `tasks.controller.ts`, `tasks.ts`, `today.ts`
(contracts), `today.controller.ts`, `packages/db/src/index.ts` each **KILLED**. The standard run on
`apps/web/middleware.ts` (browser suite) was **SURVIVED**: the request-side nonce forwarding added
in that commit changed nothing, because Next 16 already stamps the nonce from the response header
(checked in the served HTML). It was removed in `b0a1dbe`; no claim is made for it.

Targeted mutants (single-line edits, file restored byte-identical and the tree clean after each;
not the standard tool, recorded as supplementary):

| Mutant | Result |
| --- | --- |
| audit actor not passed to `withTenant` | KILLED (1 API test) |
| version conflict rethrown instead of 409 | KILLED (3) |
| existence check removed (cross-tenant 409 instead of 404) | KILLED (1) |
| completion error swallowed (`.catch(() => null)`) | KILLED (4) |
| stale version replaced by the row's current one | KILLED (2) |
| UUID guard removed from `complete` | KILLED (1) |
| client: success without checking id/status; 409 as completed; no CSRF header; network loss as completed; no refresh on unknown outcome | each KILLED (unit) |
| CSP without the nonce (island cannot hydrate) | KILLED (browser, 2 failed) |
| in-flight guard removed | KILLED (browser: `expect(posts).toStrictEqual(['POST'])`) |
| no page re-read after the outcome | KILLED (browser, 2 failed) |

## Reviews (QG-09) at `5bda9f3`

security-reviewer, architecture-reviewer and invariant-reviewer: no CRITICAL or HIGH finding.
Acted on: refresh on an unknown outcome (architecture M2), the last-rung rollback test (L5), the
CSRF-name pin (L2), the controller comment on scope (security M1 / architecture M3). Not acted on,
recorded as limits below: 409 body without the current representation (P07.13.01), rename of the
tasks error class at its source (L1), `z.uuid()` for the path parameter (L3), no database-level
state machine (pre-existing).

## Verification run

| What | Result |
| --- | --- |
| `gates.py full` at `ea78006c542a` | PASS 14/14 (`20261017T163536Z`) |
| API suite 20 times | 20 pass, 0 fail |
| J2/J3 and neighbours once (callback-intake 21, task-audit-lock-order 7, tasks 10, tasks-unassign 6, work 13 + 31, cross-tenant 14) | 102 pass |
| Browser slice (3 tests) 5 times at the final code | 5 pass, 0 fail |

`gates.py stress` runs the unit project only, so the 20× integration and 5× browser rows are plain
repeat runs, recorded here and not part of that command.

## Limits

- **P13.03.02 and .05** are open: only Erledigt exists. No [Zuweisen], [Später], [Notiz]; no
  optimistic UI and no idempotency key (the card waits for the server); the 409 body carries no
  current representation (P07.13.01 partly delivered).
- The route completes any task of the tenant, any member may; the button is on callback cards only.
  A per-type or per-role limit waits for a task capability in the P06.07 matrix.
- Completion is three moves: version +3, three `task.status` events, no single `task.complete`.
- History is `GET /api/tasks/:id` only; no completed list or page.
- No database-level state machine: the transition rules live in `setTaskStatus` (pre-existing).
- The browser suite needs the local stack and is not in the pull-request pipeline; the standalone
  owner app omits `.next/static`, which the test copies and a future web image recipe must copy.
- Deploy the API before the owner app: the strict Today schema now requires `version` (INV-17).
- Two-task transactions and other tables' lock orders stay as documented in EV-P12-013.
- A local run, not CI: **CI run pending**.
