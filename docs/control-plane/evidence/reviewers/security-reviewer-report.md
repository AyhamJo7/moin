No route registration exists elsewhere — this handler is not wired to any auth middleware in this diff, confirming there's no session-derived tenant/auth check at all here. This confirms the header-trust issue is the sole "auth" for tenant scoping.

Now compiling the final report.

## Verdict: **BLOCK MERGE**

### Critical

**C1 — Tenant context taken from a client-supplied header (cross-tenant IDOR), violates INV-02**
`apps/server/src/modules/contacts/http/contacts.controller.ts:12` — `organisationId` is read straight from `req.headers["x-org-id"]` and passed into `withTenant`, which sets the `app.organisation_id` GUC that RLS depends on (`packages/db/src/tenant.ts:15`). Any caller can set `x-org-id: <victim-org-uuid>` and read every other tenant's contacts — RLS enforcement is real, but the session variable it trusts is attacker-controlled, so FORCE RLS becomes a no-op for this endpoint. INV-02 requires tenant context to be derived server-side (session/JWT claim), never from the caller.
**Fix:** derive `organisationId` from the authenticated session/JWT set by auth middleware (not a header), reject the request if that context is missing, and add a regression test asserting a request with a forged `x-org-id` cannot see another tenant's rows.

**C2 — SQL injection via unparameterized `ILIKE` search**
`apps/server/src/modules/contacts/http/contacts.controller.ts:16` — `req.query.q` is interpolated directly into the SQL string (`WHERE name ILIKE '%${req.query.q}%'`). A query like `q=%' OR 1=1 OR name ILIKE '%` (or `'; ...`) is a classic injection reachable straight from the HTTP boundary, and combined with C1 it also gives an unauthenticated caller a path to exfiltrate or manipulate data across tenants regardless of RLS (depending on role privileges).
**Fix:** use a parameterized query, e.g. `client.query('SELECT id, name, phone FROM contacts WHERE name ILIKE $1', ['%' + escapeLike(q) + '%'])`, and validate `q` with Zod at the boundary (length limit, no control chars) before it reaches the query.

**C3 — Hardcoded live-looking Stripe secret key committed to source, violates INV-15**
`packages/integrations/src/stripe.ts:2` — `STRIPE_SECRET_KEY = "sk_live_[REDACTED-FAKE-CANARY-KEY]..."` is a literal in a committed file (even though this instance is a planted placeholder, the pattern itself is exactly what INV-15 and the global "never hardcode secrets" rule forbid — a real key pasted here would be indistinguishable and would leak via git history, image layers, and logs).
**Fix:** load the key from AWS Secrets Manager by ARN via the existing secrets-loading pattern (no key material in code, tests use a mock/test key from env), and add a `.claude/policy` / gitleaks-style pre-commit check if not already covering this path.

### High

**H1 — Tenant-specific code path in domain logic, violates INV-18**
`apps/server/src/modules/contacts/domain/contact.ts:9-12` — `greetingFor` special-cases the literal organisation name `"Gurlitt"` to return a bespoke greeting. INV-18 ("no tenant-specific code paths") exists precisely to stop this class of per-customer branching from creeping into shared code; today it's a greeting, tomorrow it's a bypassed check for one customer.
**Fix:** move any per-tenant copy/config into tenant configuration data (DB row or config table keyed by `organisationId`), not an `if` on the org name in code.

**H2 — Caller phone number logged as structured log field, violates INV-12**
`apps/server/src/modules/contacts/http/contacts.controller.ts:13-14` — `callerPhone` (PII) is read from a header and passed to `logger.info(...)` on every search request. INV-12 explicitly forbids personal data in logs; this phone number will land in whatever log aggregator/observability backend is configured, outside the audit-event path that's actually meant to hold it.
**Fix:** drop `callerPhone` from the log call entirely (or hash/redact it if it's needed for correlation), and log `organisationId` only once it is a trusted, server-derived value (see C1).

### Medium

**M1 — No input validation at the HTTP boundary**
`apps/server/src/modules/contacts/http/contacts.controller.ts:6-9` — `SearchQuery.q` has a TS type but no runtime schema (Zod); nothing bounds its length or rejects unexpected shapes (Fastify will happily hand through whatever querystring arrives). This is what let C2 be reachable as a raw string.
**Fix:** add a Zod schema for the query (`z.object({ q: z.string().min(1).max(100) })`) validated in the route handler/schema option before the string is used anywhere.

**M2 — Import job trusts caller-supplied contact rows with no runtime validation**
`apps/server/src/modules/contacts/jobs/import-contacts.job.ts:4-7,11-15` — `ImportJob.contacts` is only compile-time typed; nothing validates `phone`/`name` shape/length at the job boundary (CSV import is exactly the kind of external/event boundary the project's own standard requires Zod validation at). Low risk today because the query is parameterized, but unaccount­ed-for `organisationId` on the job means a caller of this job with the wrong org id inserts contacts into someone else's tenant with no server-side check — worth confirming the job's queue producer is trusted and org-scoped.
**Fix:** validate `ImportJob` with Zod (or Pydantic-equivalent pattern) at the job boundary, and confirm/document that `organisationId` on the job payload is set by the job producer (not user input) — if it can originate from a webhook or user upload, apply the same server-side-derivation rule as C1.

### Low

**L1 — Broken imports indicate untested code**
`contact.ts` imports `../infrastructure/pg-contact.repository` and `contacts.controller.ts` imports `../../../observability/logger`; neither file exists in the tree, so this module cannot build or have been exercised by any test. Not a security bug per se, but it means none of the above issues could have been caught by CI/tests before merge.
**Fix:** add the missing files or stub them, and land unit/integration tests for `searchContacts` and `withTenant` (including an adversarial cross-tenant test) as part of this PR — QG-09 review requires HIGH/CRITICAL findings to ship with a mutation-proven regression test.

## Remediation checklist
- [ ] C1: derive `organisationId` server-side from the authenticated session in `contacts.controller.ts:12`, never from `x-org-id`; add a cross-tenant IDOR regression test.
- [ ] C2: parameterize the `ILIKE` query in `contacts.controller.ts:16`; add a SQL-injection regression test (mutation-proven).
- [ ] C3: remove the hardcoded Stripe key from `packages/integrations/src/stripe.ts:2`; load it via Secrets Manager ARN and add/verify a secret-scanning pre-commit hook.
- [ ] H1: remove the `"Gurlitt"`-specific branch in `contact.ts:9`; move per-tenant copy to tenant configuration data.
- [ ] H2: stop logging `callerPhone` in `contacts.controller.ts:13-14`.
- [ ] M1: add Zod validation for the search query in `contacts.controller.ts`.
- [ ] M2: add runtime validation for `ImportJob` in `import-contacts.job.ts`; confirm `organisationId` provenance is trusted.
- [ ] L1: fix the missing `pg-contact.repository` and `observability/logger` imports and add tests so this module actually builds and runs in CI.