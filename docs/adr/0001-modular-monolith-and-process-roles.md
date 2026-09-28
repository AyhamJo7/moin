# ADR-0001 — Modular monolith and process roles

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0022, INV-17, INV-18, INV-19

## Context

The system has genuinely different runtime shapes inside it. A voice session is a long-lived
WebSocket with hard real-time deadlines, where a deploy that interrupts one drops a call a human is
on. An owner request is a short HTTP round trip. Queue consumers and timers run without a client
waiting. Migrations run once and exit.

The reflex is to make those separate services. The founder is one person.

## Decision

**One repository, one image, five process roles.**

| Role      | Entrypoint     | What it runs                                   |
| --------- | -------------- | ---------------------------------------------- |
| `web`     | Next.js server | Owner app and ops routes                       |
| `api`     | `main-api`     | Owner-facing HTTP API                          |
| `voice`   | `main-voice`   | Twilio webhooks and ConversationRelay sessions |
| `worker`  | `main-worker`  | Queue consumers, timers, outbox dispatch       |
| `migrate` | `main-migrate` | One-shot schema runner; exits                  |

Bounded contexts are modules inside `apps/server/src/modules/`, each owning its tables and exposing
an application-service interface and domain events. They never read each other's tables;
`dependency-cruiser` enforces it.

Each role loads only the module graph it needs, and **the role is chosen by the start command, not
by the image** (INV-17).

## Alternatives considered

| Option                                | Why not                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Microservices per bounded context** | The costs — distributed transactions, versioned contracts between services, per-service deploy and observability, and a network hop where a function call was — are paid immediately, while the benefit (independent scaling, independent teams) needs a team we do not have and traffic we do not have. Modules with enforced boundaries give most of the design discipline for none of the operational price. |
| **A single process for all roles**    | Simpler still, and wrong: a rolling deploy would interrupt voice sessions in progress (INV-19), and a memory leak in a queue consumer would take the phone down. The roles have different failure and scaling shapes and must be able to fail separately.                                                                                                                                                       |
| **Separate images per role**          | Makes "which code is in production" five questions instead of one, and lets roles drift between deploys. A shared base image does not solve it: the drift is in _when_ each was built, not in what it contains.                                                                                                                                                                                                 |
| **Serverless functions**              | A ConversationRelay session is a long-lived WebSocket with sub-second deadlines. That is the shape functions are worst at, and it is the core of the product.                                                                                                                                                                                                                                                   |

## Consequences

- One deployable artefact, one digest, one answer to "what is running" (INV-17).
- Modules must be kept honest by tooling rather than by process boundaries, which is why the
  boundary rules exist and have fixtures that violate them.
- Scaling is per role, not per module. If one module ever genuinely needs independent scaling, the
  module boundary is already the seam to extract it along — that is the point of enforcing it now.
- A dependency upgrade affects every role at once. Acceptable at this size; it would not be at ten
  times it.
- **This is the wrong call if** the team grows past the point where one repository's CI time is a
  bottleneck, or if one context's traffic diverges by an order of magnitude. Neither is near.

## Verification

| Enforcement                                      | Where                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Module boundaries, including through `require()` | `.dependency-cruiser.cjs`; fixtures in `packages/config/src/boundaries/boundaries.test.ts`                       |
| One image, role by command                       | `apps/server/Dockerfile` builds once; each entrypoint refuses to start under the wrong `SERVER_ROLE` and exits 1 |
| Role entrypoints boot and serve                  | `container-scan` builds the image; P02.03.07 verified all four roles in containers                               |
| No tenant-specific code paths                    | `moin/no-tenant-conditional` (INV-18)                                                                            |
