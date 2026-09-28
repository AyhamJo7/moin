# Conventions

The rules that are not obvious from reading the code, and the reason each exists. Branch, commit
and PR conventions are in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## TypeScript

Strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature` and `erasableSyntaxOnly` (ADR-0002).

`erasableSyntaxOnly` is load-bearing rather than stylistic: it bans enums, namespaces and parameter
properties, which is exactly the syntax Node's native type stripping cannot run. Without it a
repository script would typecheck and then fail at runtime. `apps/server` overrides it, because
NestJS resolves providers from decorator metadata only the emitter produces — and that override
stops there.

- **Named exports only.** A default export can be imported under any name, so a rename or a wrong
  import fails at runtime instead of at the type check. Next.js route, page, layout and config
  files are excepted because the framework requires them.
- **`unknown` plus a type guard, never `any`.** `any` silently disables every type-aware lint rule,
  including the ones that catch unawaited promises.
- **Validate at the boundary.** Anything crossing a system boundary — HTTP, queue, provider
  webhook, environment, file — is parsed with Zod before it is used.

## Naming

`kebab-case` files, `PascalCase` types and components, `camelCase` functions and variables,
`UPPER_SNAKE_CASE` constants. No magic numbers: a literal with meaning gets a named constant, and
the name is where the reason goes.

## Errors

Handled at system boundaries, and allowed to propagate cleanly inside a module. A `try/catch` that
logs and continues in the middle of a call stack turns a failure into a silent wrong answer.

**Never expose internal error detail to a caller.** An error message routinely echoes the input
that caused it, which is how a phone number or a connection string reaches someone who should not
see it.

## Logging

`@moin/observability` only. `console.*` is a lint error in production code because it writes
straight to stdout and skips the redaction allowlist, which is the only thing keeping personal data
out of logs (INV-12).

The allowlist is an **allowlist**: a field nobody has classified is redacted. The cost of
forgetting is a harder debugging session rather than a personal-data leak.

```ts
logger.info({ organisationId, callId, durationMs }, 'call finished'); // classified fields
logger.info({ callerName: contact.name }, 'call finished'); // → "[redacted]"
```

Note what this cannot catch: ``logger.info(`no contact for ${phone}`)`` puts the number in the
message, where no allowlist can reach it. That is a review concern.

## Database

- Every query goes through `withTenant(organisationId, …)` or `withSystemWork(…)`. A query on a
  bare handle runs without tenant context, so RLS either denies everything or, on a table where
  someone forgot `FORCE ROW LEVEL SECURITY`, returns another tenant's rows (INV-01, INV-02).
- Raw handles live behind `@moin/db/pool` — a separate entry point, so the boundary rule has an
  import it can see.
- **Parameterised queries only.** String-built SQL is a lint error. Identifiers cannot be
  parameterised; the few places that interpolate one carry an individual `eslint-disable-next-line`
  with its justification.
- **No session-level `SET`.** It leaks onto the next checkout of a pooled connection. Use
  `set_config(..., true)` inside the transaction.
- **Expand/contract migrations** (QG-08). `scripts/check-migrations.ts` enforces it, and an
  exception must state its reason on the same line.

## Module boundaries

Modules talk through exported application services and domain events, never by importing another
module's `domain/`, `infrastructure/` or `http/`. Provider SDK code lives behind a port in
`packages/integrations`, `packages/telephony` or `packages/ai`.

`dependency-cruiser` enforces this, including through `require()`, and the rules have fixtures that
violate them — a boundary rule nobody has seen fire is indistinguishable from one that does not.

## Tenant-specific code

Banned (INV-18). A single `if (orgId === 'gurlitt')` is invisible to every test that uses a
different tenant, survives review by anyone grepping for the customer name rather than the id, and
quietly makes the product unsellable to customer number two. Differences are configuration: tenant
settings, feature flags, templates.

## Brand strings

The product name is configuration, never a literal (ADR-0034). `moin` is an internal codename and
must never appear in a customer-visible surface — a leaked codename in a greeting or an email
footer is a defect, not cosmetic.

## Secrets

Only in AWS Secrets Manager, referenced by ARN (INV-15). Never in code, a config file, a database
row or a log line. The configuration loader's error path is deliberately shape-only for
secret-bearing variables: a validation library's default message will happily print the value it
rejected.

## AI

**AI proposes; deterministic software disposes.** A model never decides authorization, tenancy,
identity merges, permissions, irreversible actions, payment or booking success, a commitment to a
customer, or life-safety wording. Every model output crossing into an action is validated by code.

## German

The product is German. The owner app, every caller-facing string and every notification are
German; code, comments and commits are English. Tests run in `de-DE` / `Europe/Berlin`, because a
browser negotiating `en-US` hides every localisation bug.
