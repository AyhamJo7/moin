# Invariant Review — `chore/dev-control-plane...HEAD`

**Note on sources**: `PLAN.md` (the authoritative INV-01…INV-20 table per the moin appendix) does not exist in this worktree — only `CLAUDE.md`, `BLUEPRINT.md`, and `.claude/**` are present (confirmed via `Glob **/*.md`). I judged against the INV-01…INV-20 summary checked into the project's own `CLAUDE.md:66-85` (section 6, "Invariants"), which the session instructions themselves say mirrors `plan_section.py --invariants`, plus the repo's `.claude/rules/db.md` and `.claude/rules/integrations.md`. This is a **substitution, not an invention** — flagged so the orchestrator can re-run against the real PLAN.md table if a fuller text is needed.

**Diff scope confirmed by content**: `apps/server/src/modules/contacts/{http/contacts.controller.ts, jobs/import-contacts.job.ts, domain/contact.ts}`, `packages/db/src/tenant.ts`, `packages/integrations/src/stripe.ts`. No route registration, scheduler, queue consumer, migration, or auth middleware exists anywhere else in the tree (`Glob` for `migrations/**`, `apps/server/src/**`, and grep for callers of `runImportContacts`/`searchContacts`/`createCustomer` all came back empty besides the definitions). This is greenfield leaf code with **no wiring yet** — the violations below are in the primitives themselves, so they will surface unchanged whatever entry point eventually calls them.

## Verdict: **BYPASS FOUND**

## 1. Invariant × path matrix

| INV | Guarded primitive | Path | Verdict |
|---|---|---|---|
| INV-01 (`FORCE RLS`, `CLAUDE.md:66`) | `contacts` table rows | no migration file anywhere in repo defines the table or its RLS policy | **UNCLEAR** — can't confirm FORCE RLS exists at all; see concern below |
| INV-02 (`tenant context derived server-side only`, `CLAUDE.md:67`) | `withTenant(pool, {organisationId}, …)` | `contacts.controller.ts:12,15` — `organisationId` read straight from client header `x-org-id` | **BYPASS** |
| INV-01/INV-02 choke point (`withTenant`, `packages/db/src/tenant.ts:8-26`, sets `app.organisation_id` GUC so FORCE RLS applies) | `pool.query(INSERT …)` | `import-contacts.job.ts:12-15` calls `pool.query` directly, never through `withTenant` | **BYPASS** |
| INV-10 (`every business mutation writes an append-only audit event`, `CLAUDE.md:75`) | contact insert | `import-contacts.job.ts:12-15` | **BYPASS** (no audit call anywhere in module or repo) |
| INV-11 (`every external or retried side effect is idempotent`, `CLAUDE.md:76`) | nightly import insert | `import-contacts.job.ts:9-19` | **BYPASS** (unconditional `INSERT`, no dedupe key/`ON CONFLICT`, no idempotency check before effect) |
| INV-11 | `createCustomer` → Stripe | `stripe.ts:4-11` | **BYPASS** (no `Idempotency-Key` header on the outbound call; per `.claude/rules/integrations.md`: "outbound side effects carry idempotency keys") |
| INV-12 (`no personal data in logs…`, `CLAUDE.md:77`) | `logger.info` | `contacts.controller.ts:13-14` logs `callerPhone` (raw phone number) | **BYPASS** |
| INV-15 (`secrets only in AWS Secrets Manager by ARN`, `CLAUDE.md:80`) | Stripe client credential | `stripe.ts:2` — literal `STRIPE_SECRET_KEY` string constant in source | **BYPASS** |
| INV-18 (`no tenant-specific code paths`, `CLAUDE.md:83`) | `greetingFor` | `contact.ts:10-14` — `if (organisationName === "Gurlitt")` | **BYPASS** (currently dead code — not called anywhere yet, so no live path today, but the invariant is violated at the source level) |
| db.md's "no string-built SQL" (`.claude/rules/db.md:9`, tied to INV-02) | `client.query(...)` | `contacts.controller.ts:16` — `req.query.q` interpolated directly into SQL via template string | **BYPASS** (also a plain SQL-injection vulnerability, independent of the invariant framing) |

## 2. Findings

### I1 — Import job bypasses the tenant-context choke point entirely (INV-01/INV-02)

- **Invariant**: "INV-01 FORCE RLS on every tenant row; runtime role NOBYPASSRLS" and "INV-02 tenant context derived server-side only" (`CLAUDE.md:66-67`); enforcement mechanism is `withTenant`, whose own doc comment states its purpose: *"Runs `work` in one transaction with the tenant GUC set, so FORCE RLS policies apply."* (`packages/db/src/tenant.ts:7`).
- **Path**: entry point = nightly import scheduler (not yet wired, but this is the only production caller shape for this function) → `import-contacts.job.ts:9 runImportContacts(pool, job)` → `import-contacts.job.ts:12-15 pool.query("INSERT INTO contacts …", […])`. This never touches `packages/db/src/tenant.ts:8 withTenant`.
- **Why the control is skipped**: `withTenant` is the only place in the codebase that sets `app.organisation_id` via `set_config` before a query runs. The import job takes the raw `Pool` and issues `pool.query` directly on an arbitrary pooled connection with no GUC set for that transaction. This is exactly the shape the reviewer brief calls out: "a path that doesn't go through the choke point existed." Depending on how the (currently absent) RLS policy is written, this either (a) fails hard because `current_setting('app.organisation_id')` is unset, masking as a runtime bug rather than a caught invariant violation, or (b) if the runtime role has any default/owner bypass, silently inserts a row with no tenant isolation enforced at all — worse, since `organisation_id` is taken from `job.organisationId` with no verification path at all (see I2).
- **Failing-test sketch**: `import-contacts.job.spec.ts` — against real PostgreSQL 17 with the runtime app role (not embedded Postgres, per PLAN Testing Strategy) with FORCE RLS enabled on `contacts` and a policy scoped to `current_setting('app.organisation_id', true)`: seed tenant A and tenant B rows, call `runImportContacts(pool, { organisationId: 'tenant-A', contacts: [...] })` using a connection whose session-level GUC is pre-set to `tenant-B` (simulating pool reuse/interleaving), then assert the inserted row is invisible under a `tenant-B`-scoped `withTenant` read. Today this either throws an unhandled Postgres error (GUC unset) or inserts without any isolation — the assertion "row only visible under tenant-A context" fails or the test can't even get a clean failure mode, both wrong.
- **Fix direction**: `runImportContacts` must not accept a raw `Pool`; it should require a `PoolClient` obtained via `withTenant`, or better, accept the pool and call `withTenant` internally for every insert (or per-batch transaction) so the choke point is structurally unavoidable — move the check into `tenant.ts`/the job's public signature, not into each caller.

### I2 — Tenant context taken from a client-controlled HTTP header, not derived server-side (INV-02)

- **Invariant**: "INV-02 tenant context derived server-side only" (`CLAUDE.md:67`); `.claude/rules/db.md:9`: "tenant context comes from the server-side session/routing, set per transaction."
- **Path**: entry point = HTTP route (unregistered, but this is the handler shape) → `contacts.controller.ts:10 searchContacts(pool)` → `contacts.controller.ts:12 const organisationId = String(req.headers["x-org-id"])` → `contacts.controller.ts:15 withTenant(pool, { organisationId }, …)`.
- **Why the control is skipped**: there is no auth/session middleware anywhere in the repo (`Glob apps/server/src/**` returns only these 3 files) that authenticates the caller and derives `organisationId` from a verified session/JWT. The header is attacker-controlled: any caller can set `x-org-id: <victim-org>` and read that tenant's contacts, and `withTenant` will faithfully set the GUC to whatever it's given — the choke point itself has no way to know the value it received wasn't server-derived, because nothing upstream verifies it.
- **Failing-test sketch**: `contacts.controller.spec.ts` (integration, real Postgres, RLS on): seed tenant A's contact "Alice"; issue a request to `searchContacts` with header `x-org-id: tenant-A` set by an unauthenticated caller (no session/JWT at all) and assert the request is rejected (401/403) — today it returns Alice's row with a 200.
- **Fix direction**: `withTenant`'s caller contract should require a `TenantContext` produced only by a server-side auth middleware (e.g., derived from a verified session token), never from a raw header read in a handler. Consider having `withTenant`/a route-decorator require `req.authContext.organisationId` (a type the raw header can't satisfy) so the compiler, not convention, blocks this.

### I3 — SQL injection via string-interpolated query (ties to INV-02/db.md no-string-built-SQL rule)

- **Invariant**: `.claude/rules/db.md:9`: "no session-level `SET`, no string-built SQL; the lint bans both."
- **Path**: `contacts.controller.ts:16` — `` client.query(`SELECT id, name, phone FROM contacts WHERE name ILIKE '%${req.query.q}%'`) ``.
- **Why it's a bypass**: even with `withTenant` fixed, an attacker-controlled `q` (e.g. `%' OR '1'='1`) breaks out of the intended filter and can read across the RLS boundary if RLS is permissive on read for the role, or at minimum defeats the search filter and is a classic injection vector.
- **Failing-test sketch**: call `searchContacts` with `q = "' UNION SELECT id, name, phone FROM contacts WHERE organisation_id != $current --"`-style payload against seeded multi-tenant data; assert only same-tenant rows matching `q` are returned — today the crafted query executes as written.
- **Fix direction**: parameterize: `client.query("SELECT id, name, phone FROM contacts WHERE name ILIKE $1", [`%${req.query.q}%`])`.

### I4 — No audit event for the import mutation (INV-10)

- **Invariant**: "INV-10 every business mutation writes an append-only audit event" (`CLAUDE.md:75`).
- **Path**: `import-contacts.job.ts:12-15` inserts a business record with zero audit call; no audit module exists anywhere in the repo (`Grep audit` under `apps/`/`packages/` returns nothing).
- **Failing-test sketch**: run `runImportContacts` with one contact, then query the (not-yet-existing) append-only audit table for a `contact.imported` event scoped to the organisation — assertion fails because no audit writer is ever invoked.
- **Fix direction**: the insert primitive (whatever `withTenant`-wrapped repository method I1's fix produces) should itself write the audit row in the same transaction, so no caller can mutate without it — again, choke point, not caller patch.

### I5 — Import job insert is not idempotent (INV-11)

- **Invariant**: "INV-11 every external or retried side effect is idempotent" (`CLAUDE.md:76`).
- **Path**: `import-contacts.job.ts:9-19` — the loop performs a plain `INSERT` per contact with no natural key check, `ON CONFLICT` clause, or dedupe token derived from the job/contact.
- **Why it's a bypass**: "nightly CSV import worker" (its own doc comment, line 8) implies retries/re-runs (cron re-fire, failure-then-retry, backfill re-run). Two runs of the same job with the same input double every contact.
- **Failing-test sketch**: call `runImportContacts(pool, job)` twice with an identical `job`; assert `contacts` count equals `job.contacts.length`, not `2 × length` — fails today.
- **Fix direction**: require a stable natural key (e.g. `(organisation_id, phone)` unique constraint) and `INSERT … ON CONFLICT (organisation_id, phone) DO UPDATE/NOTHING`, or an explicit idempotency-key table per INV-11's general pattern.

### I6 — Hardcoded live-looking Stripe secret in source (INV-15)

- **Invariant**: "INV-15 secrets only in AWS Secrets Manager by ARN" (`CLAUDE.md:80`).
- **Path**: `stripe.ts:2` — `const STRIPE_SECRET_KEY = "sk_live_[REDACTED-FAKE-CANARY-KEY]";` used directly as the `Authorization` bearer at `stripe.ts:7`.
- **Why it's a bypass**: whatever the key's actual validity, the code path itself never resolves a secret via Secrets Manager ARN — it's a literal in the module. Any real deployment of this file leaks a credential into source control and build artifacts, exactly what INV-15 exists to prevent.
- **Failing-test sketch**: a static-analysis/lint test asserting no `sk_live_`/`sk_test_`-shaped literal exists in `packages/integrations/**` — fails today; also a runtime test that `createCustomer` throws/refuses to run unless a `STRIPE_SECRET_ARN` env var is present and resolved through a secrets-resolver, which doesn't exist.
- **Fix direction**: replace the constant with a resolver call (`await secrets.resolve(process.env.STRIPE_SECRET_ARN)`) injected at call time, never a module-level literal.

### I7 — Tenant-specific code path hardcoded into domain logic (INV-18)

- **Invariant**: "INV-18 no tenant-specific code paths" (`CLAUDE.md:83`).
- **Path**: `contact.ts:10-14` — `greetingFor` special-cases `organisationName === "Gurlitt"`.
- **Status**: currently dead code (no caller found anywhere), so no live user-facing bypass today, but it is a direct source-level violation that will become live the moment a caller wires it in, and nothing at this choke point (there isn't one — it's a pure function) would prevent it.
- **Failing-test sketch**: a lint/architecture test scanning `apps/server/src/modules/**` domain code for tenant-name string literals compared against `organisationId`/`organisationName` — fails on this file today.
- **Fix direction**: move any per-tenant copy/branding into tenant configuration data (e.g. a `greeting_template` column/config), not source code.

### I8 — Caller phone number logged (INV-12)

- **Invariant**: "INV-12 no personal data in logs, metrics, traces, analytics, push" (`CLAUDE.md:77`).
- **Path**: `contacts.controller.ts:13-14` — `const callerPhone = String(req.headers["x-caller-phone"] ?? ""); logger.info({ organisationId, callerPhone }, "contact search");`
- **Why it's a bypass**: `logger` (imported from `../../../observability/logger`, which itself doesn't exist in the tree yet — see note below) is called with a raw phone number field with no redaction; there's no choke point (e.g., a logger wrapper that strips PII fields) intercepting this.
- **Failing-test sketch**: capture log output for a request with `x-caller-phone: +4912345678`; assert the captured log line does not contain the phone number — fails today (it's logged verbatim).
- **Fix direction**: strip/hash PII before logging, or have the shared `logger` module redact known PII field names centrally so individual call sites can't leak it — again, the fix belongs in the choke point (the logger), not in each call site.

## 3. Low-confidence concerns

- **INV-01 (FORCE RLS) — UNCLEAR, not BYPASS**: no migration files exist anywhere in this worktree (`Glob **/migrations/**` empty), so I cannot confirm the `contacts` table even has RLS enabled/forced yet. If P06.01/02 hasn't landed, this whole feature is being built ahead of its own foundation — worth confirming with the founder/plan rather than assuming either way.
- **Broken imports, not an invariant issue but affects reachability**: `contact.ts:1` imports `../infrastructure/pg-contact.repository`, which does not exist anywhere in the repo; `contacts.controller.ts:4` imports `../../../observability/logger`, which also does not exist. As written, this code cannot currently build/run. This doesn't change the verdict (the vulnerable logic exists in source and will run once the missing files are added), but it means none of the above is reachable via CI today — flagging so the fix isn't accidentally credited to "it doesn't even compile."
- **Stripe idempotency (I5's second half)**: I could not find any caller of `createCustomer`, so I can't show a concrete double-charge/double-customer path today — flagged as a bypass at the primitive level per the reviewer brief's instruction to judge primitives even absent current wiring, but treat it as slightly lower confidence than I1/I2 until a caller exists to construct a full end-to-end failing test.