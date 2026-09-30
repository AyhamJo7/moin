# ADR-0017 — Tenant audit architecture

- **Status:** PROPOSED (founder acceptance pending)
- **Deciders:** founder
- **Phase:** P06
- **Related:** ADR-0003, ADR-0018, INV-01, INV-10, INV-12, QG-09

## Context

Every business mutation must leave an ordered, tenant-scoped record that a later reviewer can inspect. Application code also needs to record rejected actions and security events without writing raw request bodies, credentials or contact details into a durable audit trail. Tenant isolation and FORCE RLS apply to audit records as they do to other tenant data.

## Decision (draft)

An audit append and the business mutation it describes run in one tenant transaction. Provisioning precedes an application tenant session, so its global request insert triggers the audit append after the provisioning function sets transaction-local tenant context. The runtime role has SELECT but no direct INSERT, UPDATE, DELETE or TRUNCATE grant on `audit_events` or `audit_heads`. A reviewed `SECURITY DEFINER` function checks a fixed operation and argument policy, locks the tenant head, allocates the next sequence, hashes the previous hash with a canonical payload, inserts the event and advances the head in that transaction. A trigger rejects UPDATE and DELETE even by the table owner, and a second one rejects `TRUNCATE`,
which is a third row-removing verb that no row-level trigger sees. Every guard is `ENABLE ALWAYS`
rather than the default `ENABLE`: the default is origin-only and does not fire when
`session_replication_role` is `replica`, which is a session setting rather than DDL and would let a
guard be switched off with no schema change and nothing left behind to find. The function has an exact QG-09 allowlist entry, a pinned search path and no dynamic SQL.

The stored payload uses explicit typed fields and opaque identifiers. Operation-specific argument keys must be registered with a constrained value kind; an unknown key fails closed. Query and verification APIs always execute under tenant RLS. Until an external immutable anchor is implemented, a privileged actor able to rewrite both events and head can forge a consistent replacement chain; the current chain detects accidental corruption and unauthorised runtime mutation, not that attack.

### The head and the insert path are part of the chain, not around it

Verification walks `seq <= last_seq` and then compares its running hash with `last_hash`. That makes
the head, and the INSERT path, the cheapest things to attack — and neither requires rewriting a
committed event. Both were measured before they were guarded:

- `UPDATE audit_heads SET last_seq = 0, last_hash = <zeros>` left every event in place and made
  verification return `valid: true, checked: 0` for a tenant with a full trail. One statement per
  tenant turned the whole daily sweep into a no-op with no alarm.
- inserting a row at `seq = last_seq + 1000000` with arbitrary hashes was not an UPDATE or a DELETE,
  so the append-only trigger never saw it. Verification reported the chain sound while
  `listAuditEvents`, which has no head bound, served the forged row as genuine.

So the head may only ever move **forward by exactly one** — the writer's re-lock, which leaves it
unchanged, is the only other permitted update, and its hash may not change while its sequence stands
— and an event may only be inserted correctly linked to the head: right sequence, right `prev_hash`,
and a hash that is actually the SHA-256 over them. The reviewed writer satisfies both by
construction. The verifier additionally reports `event-past-head` when any sequence exceeds the
head, read in the same snapshot as the head so a concurrent append cannot raise a false alarm. That
one check covers both attacks, because a rolled-back head and a forged insert look identical from
below.

### One snapshot, because two questions invent breaks

Verification needs three facts to start: whether a head exists, what it says, and whether any event
exists beyond it. Asking separately is a false-alarm generator. These run at READ COMMITTED, so each
statement takes its own snapshot, and a verifier that read "no head" and then asked "any events?"
would see a tenant's legitimate **first** append land in between and report `missing-head` for a
chain that was perfectly sound — measured: statement one saw zero head rows, statement two saw one
event. An integrity alarm that cries wolf is worse than no alarm, because the next real one is
ignored.

All three facts therefore come from scalar subqueries in a single statement, evaluated against one
snapshot. That shape also always returns exactly one row, which removes the case that made a second
question necessary at all: `from audit_heads` returned nothing precisely when there was no head. The
genuine defect — events present with no head — is still a break, and is reported with the highest
orphan sequence rather than a placeholder.

### The daily verifier, and the register it needs

A daily sweep walks every tenant chain and alarms on a gap or mismatch. It connects as the
**application** role, because verifying through a privileged connection would prove the chain is
intact for a reader production does not have.

Enumerating the tenants cannot be done unelevated, and this was measured rather than assumed: with
no tenant context, FORCE RLS hides every row of `organisations` from `moin_migrator`, which owns the
table, and a `SECURITY DEFINER` function owned by it returns nothing for the same reason. There is
no role permitted to enumerate tenants, and creating one would mean `BYPASSRLS`, which INV-01
forbids. The tenant list is therefore a global register, `audit_chain_registry`, holding one opaque
identifier per chain and no customer data — a tenant-resolution mechanism, which by
`docs/architecture/global-tables.md` rule 3 cannot itself be tenant-scoped without circularity.

Three properties make the register load-bearing rather than incidental bookkeeping:

- **A trigger on `organisations` fills it**, not the provisioning function, because a migration or a
  repair script can also insert a tenant, and those are exactly the paths where a bookkeeping step
  is forgotten. A trigger on the table cannot be forgotten.
- **It is append-only**, enforced by a trigger for the table's owner as well. A register a
  privileged actor can delete from makes "remove the row" the cheapest way to hide a tampered chain:
  the sweep would skip that tenant and report a clean run.
- **It is enumerated instead of `audit_heads`**, which would be cheaper and would hide the most
  interesting failure — a deleted head with its events still present. Walking the register turns
  that into a `missing-head` finding rather than a tenant that quietly leaves the worklist.

`moin_app` has no grant on the register. It reads a key-paged, capped set of identifiers through
`app.claim_audit_chains`, the `withSystemWork` claim shape this repository already reviews
(P06.14.01), and re-reads each chain inside `withTenant` as itself.

### Coverage is a property of the register, not of the worklist

The sweep has a wall-clock deadline, and when it fires it has to say whether it finished. It cannot
answer that from the tenants it claimed: every claimed tenant is also processed, so subtracting
outcomes from claims yields zero whether or not anything remains. With one tenant per page and a
deadline expiring after the first page, "one claimed, one sound" read exactly like a complete estate
— a sweep reporting a clean day having looked at one tenant out of hundreds.

So the shortfall is counted from the register, through `app.count_audit_chains`, which returns a
count and no identifiers. The report carries `unreached` and an explicit `coverageComplete`, and
`isSound` requires both. A shortfall that could not even be counted sets `coverageComplete` false
with `unreached` at zero, because not knowing whether coverage was complete is not the same as it
being complete.

The deadline is also checked _after_ a page rather than before one, so a sweep always makes progress
on at least one page. A run that exits having verified nothing because its deadline had already
expired is strictly worse than one that verifies a page and reports the shortfall.

### A break, a gap and an outage are three different incidents

The sweep distinguishes chains that are _sound_, _broken_ and _unchecked_, and refuses to collapse
the last two into the first: a tenant that could not be verified is a hole in the day's coverage,
not a pass. The process exit code carries the same split — `0` sound, `3` a broken chain, `1` a
sweep that could not complete — so that a database outage does not page somebody for suspected
tampering. `docs/runbooks/audit-chain-break.md` is named on every alarm line.

### The register is reconciled against an independent witness

On its own the register is its own witness, and that is not enough: the registration trigger can be
disabled and re-enabled around a single insert, leaving nothing in the catalog to find afterwards and
that tenant's chain reading as absent rather than unchecked, forever.
`provisioning_requests` is the independent witness — global, deliberately outside RLS so retries can
be made idempotent before tenant context exists, and written for every tenant the application can
create. `app.unregistered_audit_chains` returns the difference, the sweep reports it as
`unregistered`, and `isSound` is false whenever it is non-zero. The catalog check asserts the same
property, so CI fails on a gap even after the trigger has been put back.

The migration that creates the register also backfills it, which is not optional: the trigger only
sees inserts that come after it, the register is append-only, and no non-superuser role can
enumerate `organisations` — so a tenant that misses registration could never be added later. The
backfill lifts FORCE for the length of that one transaction, because the obvious
`INSERT … SELECT id FROM organisations` inserts zero rows and raises nothing.

### Pinning what the guards do, not only what they are

Every catalog rule pins a function's _identity_ — signature, owner, `search_path`, grants,
`prosecdef` — and none of them says anything about its behaviour. `CREATE OR REPLACE FUNCTION
app.reject_registry_mutation() … BEGIN RETURN NEW; END` keeps the same OID, name, owner, signature
and trigger wiring while removing the guard outright: cheaper than repointing a trigger, and
invisible to every identity rule. So the body of each guard and each privileged writer is pinned by
digest as well. A deliberate change is a one-line edit to the reviewed list, which is the point.

### Checking that the argument policy held

The writer refuses an unregistered key and a value of the wrong kind. That is the control, and
`scripts/check-audit-arguments.ts` is the separate check that it held: the registry can be widened
by a later migration, and rows can arrive by a path that is not the writer. Its strong rule is
structural rather than pattern-based — the only string-valued kind the registry permits is `uuid`,
so any stored argument string that is not a UUID is an unreviewed value, whatever it contains. It
never prints the value it finds, because printing it would be the leak.

Pseudonymisation and retention are separate decisions under ADR-0018 and require a reviewed chain-preserving design before implementation. The current append-only trigger provides no erasure exception.

## Known residuals, named rather than implied

These are open. Each was found by adversarial review of this design and each needs a decision that
is outside P06.10's scope; none is claimed as handled.

| Residual                                                                                        | Why it is still open                                 | Owner                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`moin_app` can enumerate every tenant id.**                                                   | `EXTERNAL_DEPENDENCY` (EXT-09)                       | The daily sweep runs as the request-serving role, so a SQL-injection flaw reachable as `moin_app` yields the tenant inventory and the customer count. RLS still prevents data access and tenant context is server-derived, so this costs the unguessable-identifier layer, not isolation.                     | The fix is a dedicated non-superuser role for the verifier (`DATABASE_AUDIT_URL`), and roles are cluster-level objects that `moin_migrator` deliberately cannot create — Terraform provisions them (P05, EXT-09). Until then the capability is granted to `moin_app`, which is the reviewed claim-function shape P06.14.01 already sanctions. | founder / P05 |
| **`operation`, `target_kind` and `versions` are caller-supplied and only pattern-constrained.** | `FOUNDER_DECISION_REQUIRED`                          | `hans.mueller-at-example.de` satisfies the `operation` CHECK, so a future handler that derives an operation name from request data could write personal data into an append-only, un-erasable column.                                                                                                         | Closing it properly means a reviewed registry of permitted `(operation, target_kind)` pairs and a writer that fails closed on an unregistered pair — a change to the writer contract every future caller depends on. The scanner currently catches only values that violate the CHECK, i.e. a dropped constraint.                             | P07 / P16     |
| **`locations` carries full DML for `moin_app` with no audit obligation.**                       | `FOUNDER_DECISION_REQUIRED`                          | A location rename or delete leaves no audit event and the chain still verifies. Latent today: no application code mutates `locations` yet.                                                                                                                                                                    | The general shape is already acknowledged below ("Infrastructure alone cannot prove that every future caller does so"), but this is the one concrete place the database _hands out_ the capability. The fix belongs with the business-action model, which decides how mutations and their audit appends are bound together.                   | P07           |
| **The alarm lines bypass `@moin/observability`.**                                               | `FOUNDER_DECISION_REQUIRED`                          | `verify-audit` writes JSON to stdout with `console.log`, which skips the INV-12 redaction allowlist that every service log line goes through. The emitted shape is a closed TypeScript type and is asserted field-by-field across all line kinds, so the current output is safe; the risk is the next commit. | Routing it through `createLogger` requires adding `severity`, `seq`, `checked`, `runbook`, `sound`, `broken`, `unchecked` and `unregistered` to `ALLOWED_FIELDS`. All are non-personal counters and enums and the net effect is stricter, but it edits the INV-12 allowlist, which is a privacy control and not a session's call to loosen.   | founder       |
| **`pg_temp` sits in every definer `search_path`.**                                              | Acceptable for this PR; **not** a general conclusion | Last in the list and not exploitable for these functions, but a definer has no legitimate need to resolve caller temp objects.                                                                                                                                                                                | It is the existing repository-wide convention; changing it is a project-wide change, not a P06.10 one.                                                                                                                                                                                                                                        | founder       |

## Alternatives considered

| Option                                               | Why not                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Application-side sequence and hash                   | Concurrent writers can race, and the application role would need direct table writes.                                       |
| Unchained append-only rows                           | A missing or reordered historical row would not be apparent to a verifier.                                                  |
| Store the request body as an audit argument          | It would create a long-lived copy of personal data and secrets unrelated to the audit purpose.                              |
| Global runtime role with RLS bypass for verification | It would break the tenant boundary used throughout P06.                                                                     |
| Enumerate `audit_heads` for the daily sweep          | A deleted head row would remove that tenant from the worklist, so the sweep would skip a tampered chain and report success. |
| Let the verifier read `organisations` directly       | Measured as impossible without `BYPASSRLS`: FORCE RLS hides the table from its own owner when no tenant is set.             |
| Scan audit arguments for personal-data patterns only | Patterns find an email and miss a surname. The structural rule — no non-UUID strings — needs no prediction of shape.        |
| Fill the register from `provision_tenant`            | A migration or repair script can also create a tenant, and those are the paths that forget a bookkeeping step.              |

## Consequences

- Writes on one tenant are serialized at that tenant's chain head. The sequence is gap-free for committed events.
- Adding a new argument requires a reviewed schema row and a value-kind decision. Empty arguments work by default.
- The audit append must be called in the same transaction as each business mutation. Infrastructure alone cannot prove that every future caller does so; mutation-level tests and review remain necessary.
- Long chains require paged verification. Both the tenant sweep and each chain walk are paged, and the claim function caps a page at 1000 however much the caller asks for.
- **Full verification is O(events that have ever existed)**, because the chain is never truncated and every run re-derives it. The sweep takes an advisory lock so two runs cannot overlap, and stops claiming new pages after 30 minutes, reporting tenants it did not reach as `unchecked`. When that starts happening regularly the answer is a reviewed checkpointing design — which trades tamper-detection latency for cost — not a longer deadline.
- **No `audit.chain.run.completed` line within a day is itself an incident.** A sweep killed by its scheduler emits nothing, and silence is indistinguishable from a healthy day, so the alarm set must include absence.
- ADR-0018's erasure design will have to **drop the `audit_chain_registry → organisations` foreign key**, not merely add an exception to a trigger: with the register append-only and the key in place, an `organisations` row can never be deleted at all.
- A privileged database administrator remains in the trust boundary until external anchoring exists. A clean verifier run is therefore evidence, not proof, and the runbook says so.
- Every tenant that has ever existed keeps a register row, including a terminated one. Erasure that would remove it needs the chain-preserving design ADR-0018 owns; the append-only trigger has no erasure exception today.
- The daily _trigger_ and the CloudWatch alarms that match the emitted lines are Terraform-managed (P05/P15) and are not yet provisioned. Until they are, the sweep is run manually and P06.10.05 is not complete.
- Retention and erasure may require a future superseding ADR once counsel confirms the policy.

## Verification

| Enforcement                                                                                  | Where                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| FORCE RLS, runtime privileges, function owner/path/grants                                    | `scripts/check-rls-catalog.ts`; real-PostgreSQL audit integration tests                                                              |
| Writer remains SECURITY DEFINER; append-only trigger is present and enabled                  | `scripts/check-rls-catalog.ts`; defective-catalog fixtures                                                                           |
| Concurrent sequence, provisioning audit and rollback                                         | `packages/db/src/audit.integration.test.ts`, `packages/db/src/provisioning.integration.test.ts`                                      |
| Restricted argument keys and values, sample personal-data scan                               | `packages/db/src/audit.integration.test.ts`                                                                                          |
| Chain gap, changed event and missing tail detection                                          | `packages/db/src/audit.ts`; real-PostgreSQL tamper fixtures                                                                          |
| Head advances by one only; an event must be linked to the head; `event-past-head` detected   | `packages/db/migrations/0008_audit_events.sql`; `packages/db/src/audit.ts`; `packages/db/src/audit-verification.integration.test.ts` |
| Head absence and orphan events determined in one snapshot; no false `missing-head`           | `packages/db/src/audit.ts`; `packages/db/src/audit-verification.integration.test.ts`                                                 |
| Deadline shortfall counted from the register; `coverageComplete` required for a sound run    | `app.count_audit_chains`; `packages/db/src/audit-verification.ts`; `packages/db/src/cli.ts`                                          |
| Scanner reconciles its own coverage and validates values against their registered kind       | `scripts/check-audit-arguments.ts`; `scripts/check-audit-arguments.integration.test.ts`                                              |
| Every guard has a defective variant that its test provably kills                             | `docs/verification/audit-mutation-manifest.json`; `scripts/mutation-sweep.ts`                                                        |
| `TRUNCATE` refused on events, heads and the register; every guard is `ENABLE ALWAYS`         | `packages/db/migrations/0008_audit_events.sql`; `0010_audit_chain_verification.sql`; `scripts/check-rls-catalog.ts`                  |
| Guard and writer function **bodies** pinned by digest, not only their identity               | `scripts/check-rls-catalog.ts`; `scripts/check-rls-catalog.integration.test.ts`                                                      |
| Tenant register filled by trigger, backfilled on apply, append-only, not readable unelevated | `packages/db/migrations/0010_audit_chain_verification.sql`; `packages/db/src/audit-chain-backfill.integration.test.ts`               |
| Register reconciled against `provisioning_requests`; an unregistered tenant is never "sound" | `app.unregistered_audit_chains`; `packages/db/src/audit-verification.ts`; `scripts/check-rls-catalog.ts`                             |
| Register guard, registration trigger and claim function in the catalog                       | `scripts/check-rls-catalog.ts`; `scripts/check-rls-catalog.integration.test.ts`                                                      |
| Daily sweep: every tenant walked, break and gap distinguished from sound                     | `packages/db/src/audit-verification.ts`; `packages/db/src/audit-verification.integration.test.ts`                                    |
| Alarm severity, runbook link, exit-code split, no personal data on the log                   | `packages/db/src/cli.ts`; `packages/db/src/cli-verify-audit.integration.test.ts`                                                     |
| Stored arguments carry no unreviewed or personal value                                       | `scripts/check-audit-arguments.ts`; `scripts/check-audit-arguments.integration.test.ts`                                              |
| Daily schedule and CloudWatch alarm provisioning                                             | **Not done.** Terraform (P05/P15), founder-owned; P06.10.05 stays open on it                                                         |
