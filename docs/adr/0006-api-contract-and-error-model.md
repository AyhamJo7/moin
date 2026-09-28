# ADR-0006 — API contract and error model

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0007, INV-11, INV-12, QG-01

## Context

The owner app is the only consumer today, so the contract could be implicit. It will not stay that
way: P29 adds outbound webhooks, and a public API is on the roadmap. More immediately, an implicit
contract cannot be diffed, so nobody notices when it changes.

## Decision

**REST under `/api/v1`.** Resource-shaped, versioned in the path. Not GraphQL: the client is one
app with known screens, and GraphQL's cost — query complexity limits, N+1 avoidance, per-field
authorization — is paid against a flexibility this product does not need. Per-field authorization
in particular is significantly harder to get right under multi-tenant isolation.

**Zod schemas are the source of truth**, in `packages/contracts`, generating the OpenAPI 3.1
document. One definition validates at runtime and describes the contract, so they cannot disagree.
A CI check fails on drift.

**Errors are RFC 9457 `application/problem+json`.** A machine-readable `type`, a stable `title`, the
`status`, and a `detail` that is safe to show. Never a stack trace, never a database message,
never the input that caused the failure — an error message routinely echoes its input, which is how
a phone number reaches a log or a screen it should not (INV-12).

**Cursor pagination**, not offset. Offset pagination skips and repeats rows when the underlying set
changes between pages, which for a list of tasks someone is working through is a missed task.

**`Idempotency-Key` on every mutating request.** The client generates it; the server records the
key with the response and replays it on a retry. A retry after a timeout must not create a second
task or a second booking (INV-11). A timeout is never success.

**Correlation IDs.** `x-correlation-id` is accepted and propagated; a request id is always
generated server-side and never taken from the client, so a caller cannot collide with or forge
another request's identity.

## Alternatives considered

| Option                                        | Why not                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GraphQL**                                   | Cost is in complexity limits, N+1 avoidance and per-field authorization; benefit is client flexibility we do not need with one known client. Per-field authorization under RLS is the specific risk. |
| **tRPC**                                      | Excellent for a TypeScript-only client, and it makes a non-TypeScript consumer a rewrite. Webhooks and a public API are on the roadmap.                                                              |
| **Hand-written OpenAPI**                      | Drifts from the code the first time someone is in a hurry.                                                                                                                                           |
| **Bare `{ error: "..." }`**                   | Not machine-readable, so every client invents its own matching on message strings.                                                                                                                   |
| **Offset pagination**                         | Skips and repeats rows when the set changes under it.                                                                                                                                                |
| **Idempotency only on "important" endpoints** | The client cannot tell which is which when a request times out, so the guarantee has to be uniform.                                                                                                  |

## Consequences

- Every mutating endpoint needs idempotency-key storage and replay. Uniform, so it is one mechanism
  rather than a judgement per route.
- Cursor pagination makes "jump to page 7" impossible. No screen in this product needs it.
- Versioning in the path means `/v2` is a parallel surface when it comes, not an in-place break.
- The error contract must be tested per route, not assumed. The API suite is generated from the
  route inventory so a new route cannot quietly skip it.
- **This is the wrong call if** a consumer appears that genuinely needs field-level selection over a
  large graph. GraphQL could then be added as a read-only layer over the same services.

## Verification

| Enforcement                                 | Where                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OpenAPI matches the code                    | Drift check in CI (reserved slot already wired to fail if the script appears unwired)            |
| Every route returns `problem+json` on error | API suite generated from the route inventory (P06/P07)                                           |
| No internal detail in an error body         | Assertion in the error-contract tests; the exception filter returns a fixed shape                |
| Idempotency replay                          | Concurrency suite: the same key twice produces one effect and the same response (INV-11)         |
| Cursor pagination stability                 | Property test: inserting during pagination neither skips nor repeats                             |
| Request id never taken from the client      | `registerCorrelation`; a malformed inbound correlation id is replaced, verified in the container |
