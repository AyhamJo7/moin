# State machines

Every one is specified as a **transition table**: states down, events across, illegal combinations
blank. A blank cell is a rejected transition, not an undefined one — and that distinction is the
entire point. A state machine expressed as `if` statements has no blank cells, only paths nobody
wrote, and those paths are where a call ends in a state the system cannot describe.

Each machine ships with the property test named at the end: **every transition not in the table is
rejected**, generated from the table rather than hand-listed.

## Call session (P03.03.01)

The one with real-time deadlines and a live human on the other end.

| State         | `answered` | `routed` | `greeting_done` | `turn`     | `wrap_up`     | `ended_ok` | `timeout`  | `provider_error` | `hangup` |
| ------------- | ---------- | -------- | --------------- | ---------- | ------------- | ---------- | ---------- | ---------------- | -------- |
| `received`    | `routed`   | —        | —               | —          | —             | —          | `failed`   | `failed`         | `ended`  |
| `routed`      | —          | —        | `greeting`      | —          | —             | —          | `degraded` | `degraded`       | `ended`  |
| `greeting`    | —          | —        | —               | `dialogue` | —             | —          | `degraded` | `degraded`       | `ended`  |
| `dialogue`    | —          | —        | —               | `dialogue` | `wrapping_up` | —          | `degraded` | `degraded`       | `ended`  |
| `wrapping_up` | —          | —        | —               | —          | —             | `ended`    | `degraded` | `degraded`       | `ended`  |
| `degraded`    | —          | —        | —               | —          | —             | `ended`    | `ended`    | `ended`          | `ended`  |
| `ended`       | terminal   |          |                 |            |               |            |            |                  |          |
| `failed`      | terminal   |          |                 |            |               |            |            |                  |          |

**`degraded` is the important state.** A provider error mid-dialogue does not end the call — it
falls back to a deterministic script that takes a message and ends politely. Going straight to
`failed` would hang up on a customer mid-sentence, which is the behaviour the product exists to
replace.

**Timeouts, and why each is a number rather than a judgement:**

| Deadline       | Bound                   | Why                                                          |
| -------------- | ----------------------- | ------------------------------------------------------------ |
| Routing        | 2 s                     | Beyond this the caller hears silence and assumes a dead line |
| Greeting start | 1 s after answer        | The AI disclosure (INV-03) must not feel like a pause        |
| Model turn     | 4 s, then a filler turn | Silence past ~4 s reads as disconnection                     |
| Tool call      | 8 s                     | Then the request is noted rather than committed to (INV-05)  |
| Total call     | 10 min                  | A cap, not an expectation                                    |

**Every terminal transition writes an outcome** (INV-06). `ended` and `failed` both do —
`failed_technical` always produces a task, because a technical failure must never look like nothing
happened (INV-19).

## Interaction finalisation (P03.03.02)

The machine that makes INV-06 checkable.

| State        | `outcome_recorded` | `task_created` | `reconciler_sweep` |
| ------------ | ------------------ | -------------- | ------------------ |
| `active`     | `finalising`       | `active`       | —                  |
| `finalising` | —                  | `finalised`    | `orphaned`         |
| `finalised`  | terminal           |                |                    |
| `orphaned`   | —                  | `finalised`    | `orphaned`         |

**`orphaned` is deliberately reachable.** A conversation that reaches `finalising` and never gets
an outcome or a task is the exact failure INV-06 forbids, and pretending it cannot happen would
mean not detecting it. The reconciler sweeps for conversations stuck in `finalising`, moves them to
`orphaned`, raises a `review_failed_call` task, and alarms.

**The reconciler contract:** runs every 60 s; a conversation in `finalising` for more than 120 s is
orphaned; orphaning is idempotent; the sweep records how many it found, and a non-zero count is an
alert, not a log line.

## Task

| State         | `assign`      | `start`       | `block`   | `unblock` | `complete` | `cancel`    | `escalate`  |
| ------------- | ------------- | ------------- | --------- | --------- | ---------- | ----------- | ----------- |
| `open`        | `open`        | `in_progress` | `waiting` | —         | `done`     | `cancelled` | `escalated` |
| `in_progress` | `in_progress` | —             | `waiting` | —         | `done`     | `cancelled` | `escalated` |
| `waiting`     | `waiting`     | `in_progress` | —         | `open`    | `done`     | `cancelled` | `escalated` |
| `escalated`   | `escalated`   | `in_progress` | —         | —         | `done`     | `cancelled` | —           |
| `done`        | terminal      |               |           |           |            |             |             |
| `cancelled`   | terminal      |               |           |           |            |             |             |

`done` and `cancelled` are terminal: reopening would lose why it was closed. A recurrence is a new
task linked to the old one.

## Lead

| State       | `qualify`   | `quote_sent` | `win` | `lose` | `go_cold` | `reopen` |
| ----------- | ----------- | ------------ | ----- | ------ | --------- | -------- |
| `new`       | `qualified` | —            | —     | `lost` | `cold`    | —        |
| `qualified` | —           | `quoted`     | `won` | `lost` | `cold`    | —        |
| `quoted`    | —           | `quoted`     | `won` | `lost` | `cold`    | —        |
| `cold`      | `qualified` | —            | —     | `lost` | —         | `new`    |
| `won`       | terminal    |              |       |        |           |          |
| `lost`      | terminal    |              |       |        |           |          |

`cold` exists because "no answer yet" is not "lost", and conflating them either inflates the loss
rate or leaves leads open forever.

## Appointment request

| State       | `propose`  | `hold` | `confirm`   | `hold_expire` | `decline`  | `cancel`    |
| ----------- | ---------- | ------ | ----------- | ------------- | ---------- | ----------- |
| `requested` | `proposed` | `held` | —           | —             | `declined` | `cancelled` |
| `proposed`  | `proposed` | `held` | —           | —             | `declined` | `cancelled` |
| `held`      | —          | —      | `confirmed` | `requested`   | `declined` | `cancelled` |
| `confirmed` | —          | —      | —           | —             | —          | `cancelled` |
| `declined`  | terminal   |        |             |               |            |             |
| `cancelled` | terminal   |        |             |               |            |             |

**`confirm` is only reachable from `held`**, and a hold exists only after the exclusion constraint
accepted it. That path is what makes a double booking a database error rather than a customer
standing outside a closed shop (INV-05).

An expired hold returns to `requested` rather than failing: the caller still wants a time.

## Knowledge item

| State              | `submit`           | `approve`  | `reject` | `retire`  | `expire`  |
| ------------------ | ------------------ | ---------- | -------- | --------- | --------- |
| `draft`            | `pending_approval` | —          | —        | —         | —         |
| `pending_approval` | —                  | `approved` | `draft`  | —         | —         |
| `approved`         | `pending_approval` | —          | —        | `retired` | `expired` |
| `expired`          | `pending_approval` | —          | —        | `retired` | —         |
| `retired`          | terminal           |            |          |           |           |

Only `approved` is retrievable (INV-08). `expired` is separate from `retired` because expiry is
automatic and recoverable — an opening-hours entry that lapsed needs re-approval, not rewriting.

## Integration

| State          | `connect`    | `token_refresh_ok` | `token_refresh_fail` | `revoke`       | `provider_error` |
| -------------- | ------------ | ------------------ | -------------------- | -------------- | ---------------- |
| `disconnected` | `connecting` | —                  | —                    | —              | —                |
| `connecting`   | —            | `healthy`          | `failed`             | `disconnected` | `failed`         |
| `healthy`      | —            | `healthy`          | `degraded`           | `disconnected` | `degraded`       |
| `degraded`     | `connecting` | `healthy`          | `failed`             | `disconnected` | `degraded`       |
| `failed`       | `connecting` | —                  | —                    | `disconnected` | —                |

`degraded` before `failed`: one refresh failure is usually transient, and marking an integration
failed on the first error trains owners to ignore the alert. Entering `failed` raises a
`reconnect_integration` task.

## Tenant lifecycle

| State         | `activate` | `suspend`   | `reinstate` | `request_termination` | `grace_expire` | `purge_done` |
| ------------- | ---------- | ----------- | ----------- | --------------------- | -------------- | ------------ |
| `trial`       | `active`   | `suspended` | —           | `terminating`         | —              | —            |
| `active`      | —          | `suspended` | —           | `terminating`         | —              | —            |
| `suspended`   | —          | —           | `active`    | `terminating`         | —              | —            |
| `terminating` | —          | —           | `active`    | —                     | `purging`      | —            |
| `purging`     | —          | —           | —           | —                     | —              | `deleted`    |
| `deleted`     | terminal   |             |             |                       |                |              |

**`terminating → active` is intentionally possible; `purging → active` is not.** Accidentally
terminating a live business must be recoverable during the grace period, and deletion after it must
be real (ADR-0018).

## DSAR request

| State        | `verify_identity` | `start`      | `complete`  | `reject`   |
| ------------ | ----------------- | ------------ | ----------- | ---------- |
| `received`   | `verified`        | —            | —           | `rejected` |
| `verified`   | —                 | `processing` | —           | `rejected` |
| `processing` | —                 | —            | `completed` | —          |
| `completed`  | terminal          |              |             |            |
| `rejected`   | terminal          |              |             |            |

Identity verification precedes processing, without exception: acting on an unverified request is
itself a disclosure to whoever sent it.

## Support access grant

| State       | `grant`  | `use`    | `expire`  | `revoke`  |
| ----------- | -------- | -------- | --------- | --------- |
| `requested` | `active` | —        | `expired` | `revoked` |
| `active`    | —        | `active` | `expired` | `revoked` |
| `expired`   | terminal |          |           |           |
| `revoked`   | terminal |          |           |           |

Time-boxed by construction: there is no transition that extends a grant. Extending means granting
again, which is a new audited event.

## Property-test plan (P03.03.04)

Every machine is a table in code, and these tests are generated from it:

1. **Illegal transitions are rejected.** For each (state, event) pair not in the table, applying
   the event leaves the state unchanged and returns a typed rejection. This is the test the tables
   exist for.
2. **Terminal states are terminal.** No event moves a terminal state anywhere.
3. **Reachability.** Every non-initial state is reachable from the initial state; an unreachable
   state is either dead code or a missing transition.
4. **No silent self-loops.** A self-transition is legal only where the table says so.
5. **Sequence invariance.** For machines with concurrent events (task assignment during
   escalation), applying a shuffled legal sequence never reaches a state outside the table.
6. **Conversation finalisation.** Randomly generated call sequences always terminate with an
   outcome or an open task (INV-06).

`fast-check` generates the sequences; the tables are the oracle.
