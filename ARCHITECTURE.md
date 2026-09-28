# Architecture

A skeleton: it links the decisions rather than restating them, and grows as each phase lands.
`PLAN.md` holds the full architecture sections; this is the entry point.

## What the system is

A German small business misses calls because the people who could answer them are working. moin
answers instead: it takes the call, understands what the caller needs in German, answers from
knowledge the owner has approved, and turns everything else into a task, a lead or an appointment
request that does not get lost.

## Shape

```text
caller ──telephone──► Twilio ──webhook + ConversationRelay──► main-voice
                                                                  │
owner ───browser────► apps/web (Next.js) ──HTTP──► main-api ───────┤
                                                                  ▼
                                              PostgreSQL 17 + pgvector · Valkey · SQS · S3
                                                                  ▲
                                                   main-worker ───┘   queues, timers, outbox
                                                   main-migrate       one-shot schema runner
```

**One image per release, four roles.** Each `main-*` entrypoint loads only the module graph its
role needs, and the role is chosen by the start command (INV-17). Building four images would make
"which code is in production" four questions instead of one, and let the voice role drift from the
API role between deploys.

## Boundaries

Bounded contexts are modules under `apps/server/src/modules/`. Each owns its tables, exposes an
application-service interface and domain events, and never reads another module's tables.
`dependency-cruiser` enforces this, including through `require()`, and the rules have fixtures that
violate them — a boundary rule nobody has seen fire is indistinguishable from one that does not.

Full table: `PLAN.md` → _Domain Boundaries_.

## Decisions

| ADR                                                         | Decision                        |
| ----------------------------------------------------------- | ------------------------------- |
| [ADR-0002](docs/adr/0002-toolchain-and-runtime-baseline.md) | Toolchain and runtime baseline  |
| [ADR-0034](docs/adr/0034-naming-and-brand-decoupling.md)    | Naming and brand decoupling     |
| [ADR-0035](docs/adr/0035-local-s3-emulator.md)              | Local S3 emulator: Adobe S3Mock |
| [ADR-0036](docs/adr/0036-local-oidc-provider.md)            | Local OIDC provider: Keycloak   |

ADR-0003 (database roles), ADR-0004, ADR-0005 and ADR-0017 are written in P03.

## Invariants

Twenty non-negotiable properties, listed in full by
`python3 .claude/bin/plan_section.py --invariants`. The ones that shape this architecture most:

- **INV-01 / INV-02** — every tenant row carries `organisation_id` under `FORCE ROW LEVEL
SECURITY`; the runtime role is `NOBYPASSRLS`; tenant context is derived server-side and set per
  transaction. This is why there is a tenant wrapper and why nothing else may open a transaction.
- **INV-04 / INV-05** — models hold no credentials and execute nothing, and no commitment is made
  to a caller without a verified tool success. **AI proposes; deterministic software disposes.**
- **INV-06 / INV-19** — no interaction is lost and no call is dropped silently. Every conversation
  ends in an outcome or an open task.
- **INV-12 / INV-15** — no personal data in logs, metrics, traces or analytics; secrets only in
  AWS Secrets Manager, by ARN.
- **INV-17** — one image digest per release; expand/contract migrations.
- **INV-18** — onboarding is configuration. No tenant-specific code paths, enforced by lint.

## Where things are

```text
apps/web/          Next.js App Router — owner app and ops routes
apps/server/       NestJS (Fastify) modular monolith, four role entrypoints
packages/
  contracts/       Zod schemas → OpenAPI 3.1
  db/              migrations, tables, roles and RLS, tenant wrapper, seeds
                   @moin/db/pool is a separate entry point: raw handles are a visible act
  kernel/          value objects, German normalisation, opening hours, clock
  ai/              model gateway, prompt and policy registry, structured-output validation
  telephony/       ConversationRelay codecs, TwiML, signature validation, protocol simulator
  integrations/    provider adapters behind ports
  observability/   Pino logger with the INV-12 allowlist; OpenTelemetry from P15
  ui/              accessible components and design tokens
  testing/         factories, the real-Postgres harness, fault injection
  config/          tsconfig, ESLint and boundary presets, and the repository's own lint rules
```

## Not built yet

Most of it. This file grows with each phase; `PLAN.md`'s Status Ledger says what exists today.
