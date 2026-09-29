# ADR-0015 — Business action model

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0007, INV-06, INV-19

## Context

A call ends. Something has to happen next, and the owner has to be able to see what, without
reading a transcript or thinking about which system holds it.

The temptation is a model per channel — a voicemail list, a call log, an email inbox — which
produces the state small businesses already live in: four places to look and no single answer to
"what do I still have to do today".

## Decision

**A `Task` is the universal next action.** Every interaction that needs a human produces exactly
one. Whether it arrived by phone, email or form is a property of the task, not a different object
with its own screen.

This makes the Today screen possible, and the Today screen is the product.

**Business objects are separate from the task**, because they outlive it:

| Object               | What it is                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| `Conversation`       | A channel-agnostic interaction record: one call, one email thread                  |
| `Lead`               | A potential customer with a state machine, possibly spanning several conversations |
| `AppointmentRequest` | A request for a time, which may become an `Appointment`                            |
| `Contact`            | A person, resolved across channels (ADR-0016)                                      |

A conversation produces zero or more tasks; a lead accumulates conversations; a task points at what
it is about. Keeping them separate means closing a task does not lose the lead, and deleting a task
does not delete history.

**Every interaction ends in an outcome or an open task — never neither** (INV-06). This is the
invariant this model exists to make checkable. A conversation that ends with no outcome and no task
is a missed customer, and it is a defect rather than an edge case. A reconciler asserts it, so the
failure is detected rather than discovered by a customer who never heard back.

**Tasks are not a workflow engine.** A small set of types with a small set of states, not a canvas.
The deferred-products list says so explicitly, and this ADR is where that restraint is recorded.

## Alternatives considered

| Option                                                    | Why not                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A model per channel**                                   | Reproduces the four-places-to-look problem the product exists to remove.                              |
| **Task as the only object**                               | Closing a task would lose the lead and the history. Business objects outlive their next action.       |
| **A general workflow engine**                             | Explicitly out of scope. It moves the complexity to the customer, who is running a restaurant.        |
| **Tasks derived from conversations on read**              | A derived task cannot be assigned, snoozed, or have its own state, and its history cannot be audited. |
| **Allowing a conversation with neither outcome nor task** | This is the failure mode the product is sold against.                                                 |

## Consequences

- One inbox, one Today screen, one answer to "what is outstanding".
- A task's relationship to its business object must be explicit and typed; a loose reference would
  make the Today screen a join nobody can reason about.
- The INV-06 reconciler is a permanent background job, not a one-off check.
- Task types are a bounded, reviewed set. Adding one is a product decision, which is the intended
  friction.
- **This is the wrong call if** customers genuinely need arbitrary multi-step processes. That is the
  deferred workflow product, with its own trigger.

## Verification

| Enforcement                                                | Where                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Every finalised interaction has an outcome or an open task | Reconciler + test asserting the invariant per conversation-ending path (INV-06)            |
| A conversation cannot be finalised into neither            | State-machine property test: the transition is rejected                                    |
| Closing a task does not affect its business object         | Integration test per object type                                                           |
| Task types stay bounded                                    | The type is an enum in `packages/contracts`; adding one changes a reviewed schema          |
| A dropped call still produces a task                       | Failure-injection test: kill the voice session mid-dialogue, assert a task exists (INV-19) |
