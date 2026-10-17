# M1 vertical slice: simulated call → callback task → Heute

The first workflow that runs end to end through the real stack: a simulated caller asks a
restaurant to call back, the API records the call and creates a tenant-scoped callback task in
PostgreSQL, and the signed-in owner sees it on **Heute**. Only the call itself is synthetic.
Everything after the call boundary is the production path.

It is one slice, not the reception product. It does not establish pilot, production or sell
readiness, and it ticks no PLAN item on its own (see [Gaps](#gaps)).

## The path

```
POST /api/dev/simulated-calls          (api role; development and test only)
  SimulatorTokenGuard                  404 when CALL_SIMULATOR_TOKEN is unset, 401 on a wrong bearer
  simulatedCallSchema (contracts)      400: strict body, nothing may name a tenant
  interpretCall                        German callback phrases → "Rückruf: <topic>"; else 422
  RouteResolver → app.resolve_route    dialled number → exactly one active route, else 404
  classifyCallerId                     the From number must be a usable callback number, else 422
  WorkQueries.captureCallback          withTenant(route's organisation)
    captureCallbackRequest (@moin/db)  one transaction:
      ingestCall                         call + conversation, idempotent by CallSid (advisory lock)
      advanceCallStatus → completed
      recordOutcome callback_requested
      createTask type=callback           idempotency key callback:<conversation>, audited

GET /api/today                         (api role)
  SessionMembershipGuard               organisation from the session cookie (INV-02), else 401
  RequireRoleGuard, TenantContextInterceptor
  WorkQueries.today → listTodayTasks   withTenant(session's organisation); RLS-filtered
  todayResponseSchema (contracts)      the response is parsed before it is sent

apps/web  /  (Heute, server-rendered)
  loadToday                            forwards only __Host-moin_sid to OWNER_API_ORIGIN/api/today
  todayResponseSchema (contracts)      a drifted body is the error state, never a half-rendered task
  groupToday / sectionOf               Dringend · Rückrufe · Neue Anfragen · Termine · Kundenfragen
```

Replay is decided by a durable acceptance record, not by the task (corrected 2026-10-17, see
below). The capture writes one `callback_acceptances` row in the transaction that applies the
request. The row is tenant-scoped, append-only for the runtime role, and unique per call.

- **Replay check first.** It runs under the CallSid lock before anything is written. A replay
  therefore writes nothing, even if the call or conversation has since been erased.
- **The same call and request again** answers `200 {"replayed": true}` with the task that
  carries the request. The task's status, version and title, the call, the outcome and the audit
  trail stay as they are, whatever the owner has done with the task since. If the task was
  erased, the answer is still a replay, with `taskId: null`.
- **Calls captured before migration 0077** have no acceptance row. Their `callback_requested`
  outcome stands in for one: the finaliser never writes outcomes, and every capture writes its
  outcome together with its acceptance.
  The task a replay names is the one that capture used, found by key and not by type (the
  finaliser's fallback is itself typed `callback`): the task keyed `callback:<conversation>` in any
  status (the capture's own task, or the untyped replacement for a cancelled fallback); otherwise
  the non-cancelled (open, in progress, waiting or done) fallback under its own key (an adopted
  one); otherwise `taskId: null`. A cancelled
  fallback with no keyed task is either a replaced fallback whose replacement was erased or an
  adopted one the owner cancelled later; the data cannot tell them apart, so no id is named.
- **The same call with a different request** (dialled number or summary), or from a different
  number than the call records, is `409 /problems/callback-conflict` and writes nothing. A new
  call is a new request, even from the same caller.
- **A call first recorded by another path:**
  - the calling number is write-once: filled if the call has none, kept if it is the same, and
    `409` with nothing written if it differs, since guessing would hand the owner a wrong number;
  - the finaliser's live fallback or repair task (recognised by its key, still bearing its fixed
    title) carries the request, keeps its identity and status, and is retitled to the summary;
  - a callback task that someone closed or retitled stays exactly as it is, and a new task
    carries the summary, so neither the owner's work nor the request is lost. It has no row type
    (the one-callback-task-per-interaction index), and Heute shows it as a callback because it
    carries an accepted request.
- **Locks.** The capture takes the CallSid lock, then the finaliser's conversation lock, then the
  task row, so captures of one call and a concurrent finalise are serialised.
- **The request hash** covers the dialled number and the summary, not the caller number: a hash
  of a phone number is a reversible copy of it.

Logs carry outcome codes only: no numbers, CallSid or utterance (INV-12).

### Correction (2026-10-17)

The merged slice (#229) decided replay by the task's own idempotency key. When it adopted a
finaliser fallback, the fallback kept its key and no marker was written. A replay after the owner
completed the task then reopened it, and reported a new delivery. Adopting an existing call also
kept a missing caller number and the fallback's generic title. Both are corrected by the
acceptance record, the write-once number and the adoption rule above. The regression tests for
these cases fail against the merged code (EV-P12-011).

Heute lists at most 100 live tasks, urgent first and then newest first. When more exist, the
response says `truncated`, the page says so, and an empty section reads "In dieser Auswahl
keine." instead of "Alles erledigt.".

## Run it locally

Needs the local stack and the `TEST_*` values from `.env.example`. Nothing here reads or writes
your `.env`, and the browser test uses its own throwaway database.

```bash
pnpm dev:up                                   # PostgreSQL, Keycloak, …
set -a && eval "$(grep -E '^TEST_[A-Z_]+=' .env.example)" && set +a && unset NODE_ENV

# The API test (real PostgreSQL, real guards, fake OIDC provider)
pnpm exec vitest run --project integration apps/server/src/modules/work

# The browser test (real Keycloak login form, compiled API, standalone owner app)
pnpm --filter @moin/server build
OWNER_API_PROXY_ORIGIN=http://127.0.0.1:3101 pnpm --filter @moin/web build
pnpm exec playwright install chromium         # once
pnpm exec playwright test -c playwright.slice.config.ts
```

The browser test creates a database from the migrated template and stages two tenants, the
owner's `users` row and the number routes through the fixture role. It then starts the API
(`apps/server/dist/main-api.js`, port 3101) and the owner app (port 3000). It signs in as the
Keycloak fixture user `inhaber@musterrestaurant.example`, sends a simulated call to each tenant,
and checks that the restaurant's task appears in **Rückrufe** with caller, received time and
status. It also checks that the other tenant's task never appears, runs axe, restarts the API and
checks the task is still there. Process output goes to `test-results/e2e-slice-processes.log`.

### By hand

With an API started as in the browser test (`NODE_ENV=test`, `CALL_SIMULATOR_TOKEN` of 32+
URL-safe characters, `OIDC_*` for the local Keycloak), and a number route for the tenant:

```bash
curl -sS -X POST http://127.0.0.1:3101/api/dev/simulated-calls \
  -H "authorization: Bearer $CALL_SIMULATOR_TOKEN" -H 'content-type: application/json' \
  -d '{"callSid":"SIMdemo0001","from":"+4915112345678","to":"<routed number>",
       "utterance":"Hallo, ich hätte gern einen Rückruf wegen einer Tischreservierung."}'
```

Then open `http://localhost:3000/`, sign in, and reload.

## Configuration

| Variable                 | Where      | Meaning                                                                                                                                                                       |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CALL_SIMULATOR_TOKEN`   | api        | Enables the simulated-call entry point. The configuration loader refuses it outside development and test, and for every role but the api. Unset, the route answers 404.       |
| `OWNER_API_ORIGIN`       | web, run   | The API origin the owner app's server reads from. Unset, Heute shows its error state.                                                                                         |
| `OWNER_API_PROXY_ORIGIN` | web, build | Local only: compiles a `/api/*` rewrite to the API so the browser sees one origin, as the load balancer provides when deployed. Read at build time; unset, no rewrite exists. |

## Gaps

What this slice does not do, and where each piece belongs:

- **No real call.** The entry point is synthetic. The protocol simulator (P11.16) and the relay
  session end (P11/P12) replace it. Nothing here touches Twilio (EXT-10).
- **One intent, fixed phrases.** Callback requests only, recognised by German phrases with no
  model. The conversation flows, NLU and policy engine (P10, P12) own the rest.
- **No callback-number read-back.** Withheld, business-owned and suspicious numbers are refused
  (422) instead of being collected by DTMF with read-back (P11.11, P12.09).
- **No contact resolution.** The caller's number is stored on the call, not resolved to a contact
  (P07.03, P12.12.01).
- **No realtime.** Heute shows new tasks on reload or "Aktualisieren", not by SSE (P08, P13.02.04
  asks for 60 s).
- **No notification, no summary counts.** P14, and P13.02.02.
- **The browser test is not in CI.** The pull-request e2e job has no PostgreSQL, Keycloak or API.
  CI runs the API integration test and the signed-out smoke test.
- **`pnpm --filter @moin/server dev` cannot start the API.** It runs `src/main-api.ts` under
  Node's type stripping, which cannot run the Nest decorators. This predates the slice. The
  compiled entry point (`start:api`, `dist/`) works and is what the browser test runs.
- **Display time zone is fixed** to Europe/Berlin until the organisation's own setting is served
  (P07.14).

## Open review findings

From the QG-09 reviews and the advisory review of this change. None is HIGH, and none is fixed
here:

- **One CallSid, two tenants (LOW, INV-11).** CallSid uniqueness is per tenant. The same SID sent
  to two different tenants' numbers is recorded once in each. Closing this needs a global
  provider-event claim, which means a migration and a DEFINER function.
- **The simulator module is always mounted (LOW).** Unconfigured, it answers exactly like a route
  that does not exist, and the configuration loader refuses the token in deployed environments.
  Mounting it conditionally would be stronger.
- **Guards cross into the identity module (MEDIUM, Domain Boundaries).** `work` imports the
  session guards through `identity-access/session-guards.ts`. A cross-cutting guard surface
  (a global guard with an opt-out, or a recorded public entry and a boundary rule) is a decision
  for the PLAN.
- **Call handling sits in the simulator controller (LOW).** The relay session end will need the
  same steps, so they belong in a `voice` application service.
- **Caller number checked against the dialled number only (LOW, FS-26).** The tenant's other
  numbers are not read: `number_routes` is readable through the DEFINER lookup only.
- **No log line for the owner app's error state (LOW).** The owner app has no structured logger
  yet.
- **Derived callback type on Heute only (MEDIUM, hotfix review).** A replacement carrier has no
  row type. Heute shows it as a callback, but other task reads return `type: null`. The proper
  fix is to limit `tasks_system_interaction_unique_idx` to live tasks, which loosens a constraint
  and needs an ADR and founder approval.
- **A retitled live task gets a second task beside it (policy, hotfix review).** One reviewer
  preferred adopting the task and dropping the summary. The hotfix keeps both, so no callback
  information is discarded. Only a direct database edit can retitle a task today.
- **Acceptance rows outlive erasure (LOW, P16).** The SID, hash and time stay as a replay
  tombstone, so an erased call cannot be resurrected by a retry. P16 must define their purge.
- **The hash covers the derived summary (LOW).** If `interpretCall` changes between a delivery
  and its retry, the retry gets a 409 instead of a replay.
- **Pre-0077 calls have no tombstone (LOW).** A call captured before migration 0077 is
  recognised by its call and outcome rows. If those are erased, a retry is a first delivery
  again. Erasure (P16) is not built, and no deployed environment holds pre-0077 data (none
  exists).
- **Shared advisory-lock keyspace (LOW).** CallSid and conversation locks both use `hashtext`. A
  collision can deadlock, which PostgreSQL detects (40P01) and rolls back.
- **Historical cancelled-fallback replay returned the older task (J2, corrected).** A pre-0077
  replay could name a cancelled fallback instead of the replacement the capture created. The
  lookup now uses the key (see above). Remaining limit: an adopted fallback the owner cancelled
  later replays with `taskId: null`, as does a replaced one whose replacement was erased.
- **A pre-0077 replay does not compare the request (LOW).** It has no request hash, so the same
  CallSid with another summary or caller number is answered as a replay (nothing is written)
  instead of `409`. Found by the J2 invariant review; not changed here. A pre-0077 call whose
  conversation was erased replays as a first delivery (the existing tombstone limit above).
- **Task and audit lock order (J3, corrected for these paths).** Every audit append locks the
  tenant's `audit_heads` row and holds it to COMMIT. An owner task write (`setTaskStatus`,
  `assignTask`, `snoozeTask`, `retitleSystemTask`) locks the task row, then appends audit. The
  callback capture used to append audit and then lock the finaliser fallback it adopts, and the
  orphan sweep waited for later conversations' locks while holding the head from earlier ones;
  against an owner write on the same task PostgreSQL rolled one side back (40P01), reproduced
  with forced interleavings. Both now take their locks first, in a fixed order: CallSid and
  conversation advisory locks, task rows by id, then the call row and the audit head. The row locks
  are per conversation, under row-level security. Not covered, and documented as such: a transaction that
  writes two tasks with an audit append between them; the unmerge helper's task branch
  (`merge.ts`), which the code states is never used; other tables' row-then-audit orders (for
  example `staleness.ts`), which were not traced; and 32-bit `hashtext` advisory keys with no
  tenant namespace, where a collision can serialise unrelated work across tenants and can form a
  residual cross-key deadlock. The fix removes the task-row/audit-head cycles under these
  assumptions, not deadlocks in general.
