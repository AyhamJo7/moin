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

A repeated CallSid answers `200 {"replayed": true}` with the first delivery's task and writes
nothing. Logs carry outcome codes only: no numbers, CallSid or utterance (INV-12).

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
