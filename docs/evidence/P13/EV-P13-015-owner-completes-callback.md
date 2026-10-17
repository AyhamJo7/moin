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

Mission M2A (first version at `312e504`; independent review remediation below). Only the **Erledigt** part of P13.03.02 exists; P13.03.02 stays IN_PROGRESS and
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
- The route completes any task type; the button is on callback cards only. Who may complete is
  fixed by the remediation below (owner/admin any task, staff own or unassigned).
- Completion is three moves: version +3, three `task.status` events, no single `task.complete`.
- History is `GET /api/tasks/:id` only; no completed list or page.
- No database-level state machine: the transition rules live in `setTaskStatus` (pre-existing).
- The browser suite needs the local stack and is not in the pull-request pipeline; the standalone
  owner app omits `.next/static`, which the test copies and a future web image recipe must copy.
- **Rolling deployment is not safe in either order** (see Remediation, F3): the Today schema is
  strict on both sides, so a mixed fleet shows Heute's error state.
- Two-task transactions and other tables' lock orders stay as documented in EV-P12-013.
- A local run, not CI: **CI run pending**.

## Remediation after the independent review of PR #233 (reviewed head `312e504`)

The review returned REQUEST_CHANGES with two blocking findings and one documentation correction.
The earlier text of this record is kept; where it conflicts with this section, this section wins.

### F1 (P1): staff could complete a colleague's task

Root cause: `WorkQueries.complete` checked the session and the tenant but not the PLAN matrix row
"Act on tasks, leads, requests" (owner yes, admin yes, staff yes **assigned or unassigned**). The
hidden button was the only limit.

**Policy implemented (no PLAN change).**

| Member | May complete |
| --- | --- |
| owner, admin | any task of their tenant (new capability `tasks:act-on-any`, pinned in `roles.test.ts` and `docs/security/access-matrix.md`) |
| staff | only a task assigned to themselves or unassigned |
| any other role, or a member no longer active | nothing |

A refused member gets **403** `/problems/forbidden`, evaluated before the version check (so a stale
version never tells a forbidden member anything), and **nothing is written, not even an audit row**.
Another tenant's task and a missing task stay the identical 404. Assignment is `tasks.assignee_user_id`.

**Race protection.** The task row is locked first (`lockTask`, `SELECT ... FOR UPDATE`), then the
member's active role is read again inside the transaction, then the judgement is made on the locked
row and that committed role, then the unchanged `completeTask` walk runs. A reassignment either
commits first and is seen, or waits for the request. Lock order stays task row, then audit head (the
J3 order); the standing read is a plain read and takes no lock. Honest limit of what the lock buys:
without it the version guard on each move would still stop a stale writer (a reassignment bumps the
version), but the answer would be 409 and the decision would not be made on committed facts; the
test pins the 403.

**Tests (real PostgreSQL as `moin_app`, real HTTP and sessions; `owner-completes-callback.integration.test.ts`, now 22 tests).**

| Test | Fact |
| --- | --- |
| owner and admin complete a task assigned to someone else | 200; three events by the acting member |
| staff complete their own and an unassigned task | 200 each; events by the staff member |
| staff on another member's task, versions 2, 1 and 99 | 403 problem body each; status, version, assignee, `updated_at`, title, audit count and status events byte-identical; the assignee herself then completes it |
| reassigned after the staff member saw it | 403 with the old and the new version; frozen row |
| reassignment racing the completion | a held, uncommitted reassignment; the request blocks (`pg_blocking_pids`); after commit: 403, row open/version 3 assigned to the colleague, no events |
| own task, stale version | 409, not 403 |
| disabled member / demoted admin | sessions revoked: 401 each; frozen rows |
| stale guard scope after a committed disable/demotion (`WorkQueries.complete` called with the scope the guard had resolved earlier) | disabled member whose task the trigger unassigned: forbidden; demoted admin on a colleague's task: forbidden; frozen rows |
| other tenant's staff | same 404 as a missing id; frozen row |

Neighbours unchanged and green: the J2 and J3 suites, cross-tenant inventory, RBAC matrix suites.

### F2 (P2): a lost answer was reported as a failure

Root cause: every non-listed outcome (transport error, timeout, 5xx, unusable body) was `failed`
with "Das hat gerade nicht geklappt", although the transaction may have committed.

**Behaviour now.**

| Outcome | Established by | Owner sees |
| --- | --- | --- |
| confirmed success | 200 with this task `done` | "Der Rückruf ist als erledigt markiert." |
| confirmed rejection | explicit 400 (no refresh), 401, 403, 404, 409 | the matching German sentence (403: "Diese Aufgabe ist einer anderen Person zugewiesen. Dafür fehlt Ihnen die Berechtigung.") |
| unknown | transport error, timeout, other status, unusable 200 | read back `GET /api/tasks/:id`: if it reads `done`, the state is confirmed (`confirmedBy: 'readback'`, same sentence; it does not say who wrote it); otherwise "Der aktuelle Stand konnte nicht bestätigt werden. Bitte prüfen Sie die aktualisierte Ansicht." |

An unknown outcome always re-reads the page, and nothing is claimed beyond what was read: an open
read-back proves nothing, because a request still running on the server may yet commit. No
idempotency key and no optimistic UI were added. Focus moves to the outcome region when the card
that held it is gone.

**Tests.** Client unit tests (`complete-task.test.ts`, scripted `fetch`): every explicit status, no
read-back for explicit outcomes, read-back done / still open / unreachable / not this task, 429 and
5xx and unusable 200 read back, wording (no codes, no "fehlgeschlagen"), refresh rule. Browser
(Chromium, authoritative database check each time): (1) the request reaches the server and commits
while the browser's answer is aborted: read-back confirms, message is the completion sentence, card
gone, database done/4 with three events; (2) the answer and the read-back are both aborted: the
unknown sentence, never "erledigt markiert" or "nicht geklappt", and the refreshed view shows the
card gone because the database committed; (3) the request never reaches the server: unknown
sentence, card and database unchanged (open/1, zero events), then a keyboard-only retry (focus the
button, Enter) completes once (three events), the status region has `role="status"` and
`aria-live="polite"` and holds focus; (4) the earlier double-click test still sends exactly one POST.

### F3 (non-blocking): deployment compatibility

The earlier claim "deploy the API before the owner app" is withdrawn. `todayTaskSchema` is a strict
object on both sides: an owner app built before this change rejects the new API's Today response
(unknown key `version`), and an owner app built with it rejects an API that does not send `version`.
Either order of a rolling deployment therefore shows Heute's error state until both sides run the
same version. Nothing is deployed; no production environment exists. Before any real rollout this
needs either a coordinated cutover (maintenance window, both sides together, rollback to both) or a
future expand/contract step (first release the owner app with `version` optional, then the API, then
make it required). Neither is implemented here.

### Mutation and review evidence for the remediation

Standard `mutation_check.py`, assertion failures confirmed in the recorded output (not import
errors): `work-queries.ts` at `e31c66a` KILLED (`expected 409 to be 403`); `tasks.controller.ts` at
`e31c66a` KILLED (`expected 500 to be 403`; the reversed controller loses the 403 mapping, so this
is a behavioural but crude kill); `complete-task.ts` at `94a9a98` KILLED (refresh rule assertion);
`work-queries.ts` at the standing-read commit KILLED.

The earlier file-level kills in this record (`tasks.controller.ts`, `tasks.ts`, `today.ts`,
`today.controller.ts`, `packages/db/src/index.ts`) were reversals that remove a route, a column or
an export; they fail because something is missing, not because an assertion caught wrong behaviour.
They show the files are exercised, nothing more. The behavioural evidence is the targeted mutants.

Targeted mutants (file restored byte-identical and clean each time):

| Mutant | Result |
| --- | --- |
| assignee check removed | KILLED (including the racing-reassignment test) |
| `FOR UPDATE` removed from `lockTask` | KILLED by the racing-reassignment test only (answer becomes 409 instead of 403) |
| unassigned tasks refused to staff / own tasks refused to staff | KILLED (2 tests each) |
| admin removed from `tasks:act-on-any` | KILLED |
| refused member's walk executed anyway | KILLED |
| guard-time role trusted instead of the committed standing | KILLED |
| read-back trusted when the task is merely open / unknown reported as rejection / network loss not read back / 5xx treated as rejection | each KILLED (unit) |
| focus not moved to the outcome; read-back disabled | each KILLED (browser) |

A first attempt at the standing mutant (deleting only the undefined-role guard) SURVIVED because an
undefined role is refused by the other conditions anyway; it was an equivalent mutant and is not
counted.

QG-09 on the remediation: security-reviewer and invariant-reviewer, no critical or high finding, no
bypass, no deadlock found (membership disable takes membership then task then head; completion
never takes memberships, so no cycle). Acted on: the stale-scope gap (standing re-read, above).
Recorded, not done: an import allowlist for the task mutators (a future route could call them
without a check); `GET /api/tasks/:id` shows status and version of any task of the tenant to any
member (Heute already lists every live task; done tasks are visible by id only); no
`idle_in_transaction_session_timeout` on the tenant pool; a read-back "done" may have been written by
someone else (the sentence does not claim authorship).

### Verification of the remediation

| What | Result |
| --- | --- |
| API suite (22 tests) 20 times | 20 pass, 0 fail |
| J2/J3 (callback-intake, task-audit-lock-order), tasks, tasks-unassign, work, cross-tenant inventory and the whole identity-access integration set once | 258 pass (17 files) |
| Client unit tests | 58 pass in the web project |
| Browser slice, 6 tests, 5 times at the final code | 5 pass, 0 fail |
| `gates.py full` | run once on the final head; the exact head and result are in the PR description, because a record committed with the head cannot name it |

The 20x and 5x rows are plain repeat runs, not `gates.py stress` (which runs the unit project only).
