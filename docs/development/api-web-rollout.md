# API and owner-app rollout compatibility (M2D-1)

Status: a rollout design, verified by tests. Nothing is deployed and no hosting exists yet
(`infrastructure/terraform` holds no web or API service), so this is not a fix for a live outage: it
sets the rule the first release and every later one follows, and keeps the first rollback safe.

## The defect

`GET /api/today` returns a strict object per task. M2A (#233) added `version` to it, because
"Erledigt" needs the task's optimistic-lock version.

- A web built **before** M2A rejects an API that sends `version` (unknown key): Heute shows its error
  state.
- A web built **after** M2A rejects an API that does not send it (missing key): the same error state.

So neither deploy order was safe. ADR-0001 builds one image per release, but the owner app (`web`) and
the API are separate services that roll at different moments, and either can be rolled back alone.

## Selected strategy: negotiate the shape, tolerate its absence (expand, then contract)

1. **The web announces the contract it speaks.** Every Today read (the server render and the live
   poll) sends `x-moin-today-contract: versioned`.
2. **The API answers in that shape.** With the exact value `versioned` it sends `version` on each task.
   With anything else (no header, another value) it sends the original shape without `version`, and
   sets `Vary: x-moin-today-contract`. Both shapes are parsed through their strict schema before
   they are sent; the rows, the order and the tenant are identical.
3. **The web tolerates an API that predates versions.** `parseTodayBody` accepts the current shape, or
   the legacy shape **as a whole**. A legacy task has `version: null`: it is shown, and the card says
   "Erledigt ist gerade nicht möglich" instead of offering the button. A version is never invented or
   defaulted, so a completion without the owner's real version cannot be sent. A response that mixes
   the shapes, or carries a bad version or any extra field, is still a contract error.
4. **A rolled-back API is not misreported.** If the completion route is absent (404 without the API's
   own `/problems/not-found` body), the browser reads the task back and reports "not confirmed", not
   "the task is gone".
5. **The poller treats an upgrade or rollback as a change.** The fingerprint includes the version, so a
   list that gains (or loses) versions re-renders and the button appears (or goes) without a reload.

## Compatibility matrix

Builds are named by contract generation: **G0** = before M2A (#233), no `version`; **G1** = #233 up to
this change (`version` always sent or required, no header); **G2** = this change (header negotiation).

| Web | API                       | Result                                                                                                                                  | Proven by                                                                                 |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| G0  | G0                        | Existing behaviour                                                                                                                      | Frozen pre-M2A schema accepts the legacy shape (`today.test.ts`)                          |
| G0  | G1                        | **Broken** (the original defect): the G0 web rejects `version`                                                                          | Frozen schema rejects the current shape (`today.test.ts`)                                 |
| G0  | G2                        | Legacy shape, Heute lists tasks as before; no version leaves the API; same tenant rows                                                  | Real API + PostgreSQL, parsed by the frozen schema (`callback-today.integration.test.ts`) |
| G1  | G0                        | **Broken**: the G1 web rejects a body without `version`                                                                                 | Current schema rejects the legacy shape (`today.test.ts`)                                 |
| G1  | G1                        | Works (what main had before this change)                                                                                                | M2A/M2B suites                                                                            |
| G1  | G2                        | **Broken**: no header, so the API answers in the legacy shape. G1 builds were never deployed and must not be paired with a G2 API       | Documented, not supported                                                                 |
| G2  | G0                        | Tasks listed; Erledigt shown as unavailable and never attempted; poll stays healthy                                                     | Real `loadToday`/`pollToday`/`completeControlOf` on pre-version bodies                    |
| G2  | G1                        | Works: the API ignores the header and always sends `version`                                                                            | G1 API behaviour (always versioned); G2 web parses the current shape (`today.test.ts`)    |
| G2  | G2                        | Current behaviour: Erledigt with the task's version, 409 on a stale version                                                             | Browser suite (10 tests), J2/J3 integration suites                                        |
| G2  | G2 then API back to G0/G1 | Open page keeps working; the poll sees the change and re-renders; a click already in flight is "not confirmed" (bare 404), never "gone" | Poller and `completeTask` unit tests                                                      |

Enforcement of the unsupported G1 range: G1 is every commit from `7caad73` to its last ancestor of this
change on main (`8ee81a2`); none was released, and the release process (tags, P02.06) only builds from
main after this change. A deployment record must name the web and API image digests (INV-17); a G1 digest
beside a G2 one is the only way to reach the broken pairings.

Security: the legacy shape carries strictly less than the current one; the header cannot widen access
(it selects a shape, not a tenant, role or row), the route keeps its session, membership and throttle
guards, and the tenant stays the session's (INV-02). Unknown header values fall back to the legacy shape.

## Deployment sequence

Expand (this release, R):

1. Deploy the **API** from R. Webs from before M2A keep working (they send no header).
2. Deploy the **web** from R. It announces the contract and receives versions.

Either order is safe; API first gives owners Erledigt immediately, web first shows the "not possible
yet" line until the API follows.

Rollback: API from R back to a build before M2A, the web from R keeps working with Erledigt
unavailable. The web back to a build before M2A, the API from R keeps serving it the legacy shape.
Rolling the web back to a build from the unsupported range above is not safe.

Availability: no maintenance window is needed for this contract. Zero-downtime of a whole release is
not claimed: it depends on the hosting, which does not exist yet. During a rolling API deploy the
server render and the browser poll can reach different API versions; the page then re-renders on each
15 s poll until the roll-out ends (extra refreshes, no wrong data).

## Contract step (removal)

Two releases, in this order; skipping the order recreates the defect.

1. **API unconditional.** Ship an API that sends `version` always and ignores the header. Allowed when no
   G0 web is deployed or kept as a rollback target. The G2 web keeps working (it announces, and the
   answer has versions).
2. **Web drops the negotiation.** Ship a web that stops sending the header and removes
   `parseTodayBody`'s legacy fallback and `version: null`. Allowed when no API without `version`
   (G0, or a G2 build before step 1) is deployed or kept as a rollback target.

The check is made against the deployment record's image digests (INV-17), which name every web and API
build that is deployed or kept for rollback. Record each step's release in `PROGRESS.md`. Until step 2
is done, every change to the Today or completion contract stays backwards compatible, or adds its own
negotiation.

## Verify

```bash
pnpm exec vitest run packages/contracts apps/web          # contract, parsing, poller, completion
pnpm dev:up                                                # then export the TEST_* values from .env.example
pnpm exec vitest run --project integration apps/server/src/modules/work
pnpm --filter @moin/server build
OWNER_API_PROXY_ORIGIN=http://127.0.0.1:3101 pnpm --filter @moin/web build
pnpm exec playwright test -c playwright.slice.config.ts    # 10 tests, real Keycloak and PostgreSQL
```

## Not proven

- No real pre-M2A API or web artifact was built and run. The "old web" is the verbatim pre-M2A contract
  file (git blob `8e35ad5`, checked by hash in `packages/contracts/src/today.test.ts`); the "old API"
  is a response body in that contract's shape, produced by the new API's own legacy branch and by
  hand-built bodies.
- No browser test runs the new web against a legacy-shaped API; the degraded card is proven by the
  decision function and the loader, not by a rendered page.
- Browser tabs holding an older script bundle while the web service rolls are Next.js's concern and are
  not tested here.
- Hosting, health checks and traffic shifting are not built.
