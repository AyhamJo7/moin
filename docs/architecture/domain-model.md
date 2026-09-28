# Domain model

Entities per module, the aggregate boundaries, and the rules that hold inside each. Extends
BLUEPRINT.md's data model (L1028–1087); where this is more specific, it is because P03 had to
decide something the blueprint left open.

Module ownership is from PLAN.md _Domain Boundaries_. A module owns its tables and nobody else
reads them.

## Aggregates, and why the boundaries are where they are

An aggregate is the unit of consistency: everything inside it is updated in one transaction and
obeys its rules at every commit. Everything outside is reached by identifier and is eventually
consistent.

Drawing these boundaries too large makes every write contend. Too small, and a rule spans two
transactions, which means it is not a rule.

| Aggregate              | Root                   | Contains                              | Rule that holds at every commit                                                                   |
| ---------------------- | ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Organisation**       | `organisations`        | locations, tenant settings, lifecycle | A tenant in `terminating` accepts no new work                                                     |
| **Membership**         | `memberships`          | role assignments                      | At least one active owner per organisation — the last one cannot be removed                       |
| **Contact**            | `contacts`             | contact methods, merge records        | Each normalised contact method is unique per tenant; a merge is reversible                        |
| **Conversation**       | `conversations`        | call, messages, turns, outcome        | **A finalised conversation has an outcome or at least one open task, never neither (INV-06)**     |
| **Task**               | `tasks`                | notes, assignment, due date           | A task in `done` has a completion time and an actor                                               |
| **Lead**               | `leads`                | state, linked conversations           | State transitions follow the machine; a `won` lead has a linked appointment or an explicit reason |
| **AppointmentRequest** | `appointment_requests` | requested windows, hold               | A confirmed request has exactly one appointment; a hold expires                                   |
| **KnowledgeItem**      | `knowledge_items`      | versions, approvals, validity         | Only one `approved` version is current; an expired item is never retrievable (INV-08)             |
| **AiAction**           | `ai_actions`           | tool invocations, approvals           | Records the prompt, policy and template versions it ran under; immutable once written             |
| **AuditEvent**         | `audit_events`         | —                                     | Append-only, hash-chained per tenant. No update or delete path exists (INV-10)                    |
| **UsageRecord**        | `usage_ledger`         | —                                     | Append-only. Billing derives from this, never from a provider's numbers (INV-20)                  |

### Why `Conversation` and `Task` are separate aggregates

The tempting design makes tasks part of the conversation. It would be wrong: a task outlives the
conversation, can be reassigned, snoozed and completed days later, and several conversations can
feed one task. Keeping them separate means closing a task does not touch conversation history, and
a long-running task does not hold a lock on a live call's aggregate.

They are linked by identifier, and the INV-06 rule spans them — which is exactly why it is checked
by a reconciler rather than by a database constraint.

### Why `AppointmentRequest` is not `Appointment`

A request is what the caller asked for. An appointment exists only after a booking tool returned
success (INV-05). Collapsing them would make it possible to have an appointment nobody booked,
which is the failure mode that ends with a customer standing outside a closed shop.

## Entities by module

### `tenancy`

`organisations` · `locations` · `tenant_settings` · `tenant_lifecycle`

The organisation is the tenant boundary: every other tenant-scoped table carries its id under FORCE
RLS (ADR-0003). `tenant_lifecycle` is a state machine, not a boolean — `trial → active → suspended
→ terminating → deleted` — because "is this customer active" has more than two answers and billing,
access and retention each need a different one.

### `identity-access`

`users` · `memberships` · `sessions` · `invitations` · `operator_accounts` · `support_access_grants`

`users` is linked to a Cognito subject; authorization is ours (ADR-0005). Operator accounts are a
separate table from customer users on purpose: an operator is not a member of a tenant, and
conflating them would make "who can see this tenant's data" a query with an exception in it.

### `contacts`

`contacts` · `contact_methods` · `duplicate_candidates` · `contact_merges`

A contact is a person. Resolution is deterministic on normalised methods; anything probabilistic is
a _suggestion_ a human confirms (INV-09), and every merge is reversible, because an incorrect merge
of two customers is worse than two duplicates.

### `conversations`

`conversations` · `calls` · `call_events` · `messages` · `interaction_outcomes`

Channel-agnostic by design: a call and an email thread are the same kind of object with different
child rows. `call_events` is the ordered record of what happened during a call — routing,
checkpoints, failures — and is what makes a dropped call diagnosable (INV-19).

### `work`

`tasks` · `leads` · `appointment_requests` · `appointments` · `slot_holds` · `notes`

The next-action model (ADR-0015). `slot_holds` uses an exclusion constraint so two callers cannot
hold the same slot — the one place where the database, not the application, prevents a double
booking.

### `knowledge`

`knowledge_items` · `knowledge_versions` · `approvals` · `knowledge_chunks` · `business_profile` ·
`opening_hours` · `holidays`

Versioned with an approval gate: the assistant may state only approved, unexpired content (INV-08).
`holidays` carries both federal-state public holidays and the tenant's own Betriebsferien, which are
different things with the same effect on availability.

### `policy`

`templates` · `template_versions` · `tenant_template_bindings` · `rules` · `escalation_contacts`

Vertical templates as versioned data, bound per tenant. A tenant difference is a binding or a
setting, never a code path (INV-18).

### `assistant`

`ai_actions` · `tool_invocations` · `human_approvals` · `workflow_runs`

`ai_actions` records what the model was asked, under which prompt, policy and template versions, and
what it proposed — separately from `audit_events`, which records what the system actually did. That
separation is what makes "the model suggested X but we did Y" reconstructable.

### `platform`

`outbox` · `inbox` · `idempotency_keys` · `job_runs` · `feature_flags` · rate-limit state

Owns transactions and the tenant wrapper. The only module that may hold a raw database handle.

### `audit`

`audit_events`

Append-only, guarded by a trigger and by revoked privileges, hash-chained per tenant (INV-10).
Arguments are sanitised before they are written — an audit trail that records a password because it
was a function argument is a liability, not a control.

### `billing`

`plans` · `prices` · `subscriptions` · `entitlements` · `usage_ledger` · `billing_events`

The usage ledger is the source of truth and is append-only (INV-20). The provider's numbers are
reconciled against it, not trusted over it.

### `privacy`

`retention_policies` · `dsar_requests` · `erasure_jobs` · `deletion_ledger_refs` · `subprocessors` ·
`avv_records` · `consents`

Reaches every other module through the published `ErasureHandler` interface (ADR-0018), so a module
cannot exist without declaring how it erases.

## Relationships that carry rules

- One `Conversation` belongs to at most one `Contact` — unresolved while the caller is unknown, which
  is normal and not an error state.
- A `Conversation` produces zero or more `Task`, `Lead` or `AppointmentRequest`. **Zero is only
  legal if an outcome was recorded** (INV-06).
- A `Lead` accumulates conversations over time; it is not per call.
- A `Document` may exist without an `Invoice`; an invoice is a structured projection of one. Both
  are deferred (P34) and are listed here only because the blueprint names them.
- `AiAction` references inputs; `AuditEvent` records the mutation. One is a proposal, the other is
  what happened.

## What is deliberately absent

No `Ticket`, no generic `Workflow` canvas, no CRM pipeline beyond the lead state machine, no
`Transcript` table. Each is on PLAN's deferred or excluded list, and absence here is the design
recording that (INV-14).
