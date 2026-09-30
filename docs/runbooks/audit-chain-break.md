# Runbook — audit chain break (SEV2)

- **Alarms:** `audit.chain.broken` (SEV2) · `audit.chain.unregistered` (SEV2) · `audit.chain.unchecked` (SEV3) · `audit.chain.registry.empty` (SEV3) · `audit.chain.run.incomplete` (SEV3) · `audit.chain.run.failed` (SEV3) · `audit.chain.run.skipped` (SEV3)
- **Emitted by:** `pnpm db:verify-audit` (`packages/db/src/cli.ts`, P06.10.05) · **Invariants:** INV-10, INV-12
- **Related:** ADR-0017, ADR-0018, `docs/architecture/security-definer-allowlist.md`

## What the alarm means

Every business mutation appends an event to its tenant's audit chain in the same transaction
(INV-10). Each event stores the hash of the previous one, so the chain is a tamper-evident sequence:
changing, reordering or removing a committed event breaks it. The daily verifier walks every
registered tenant and re-derives the whole chain. A `audit.chain.broken` line means a chain did not
re-derive.

This is not a cosmetic failure. `audit_events` is append-only — `UPDATE` and `DELETE` are rejected by
a trigger for the table's owner as well, and no runtime role holds a write grant — so a break means
one of:

1. a privileged actor (database administrator, a manual repair, a restore) changed committed rows;
2. storage-level corruption;
3. a defect in the writer or in the verifier itself.

Nothing the application can do through its normal privileges produces a break.

## The three signals are different incidents

| Line                     | Severity | Means                                 | First question                                      |
| ------------------------ | -------- | ------------------------------------- | --------------------------------------------------- |
| `audit.chain.broken`     | SEV2     | a chain exists and does not re-derive | who had write access to that tenant's rows          |
| `audit.chain.unchecked`  | SEV3     | a tenant could not be verified at all | is this a permission change or a connection fault   |
| `audit.chain.run.failed` | SEV3     | the sweep could not enumerate tenants | is the register readable; **today has no coverage** |

Exit codes carry the same split: `3` is a break, `1` is "did not verify", `0` is a clean sweep. They
are deliberately distinct so a database outage does not page someone for suspected tampering.

An `unchecked`, `unregistered`, `registry.empty`, `run.incomplete`, `run.failed` or `run.skipped`
result is **not** a clean run. Each means the day has a coverage gap, and each must be resolved and re-run, not
acknowledged. `audit.chain.unregistered` is SEV2 rather than SEV3 because a chain nobody enumerates
is not a degraded check — it is no check at all, and it looks exactly like a healthy tenant.

## Fields on the alarm

`organisationId` (opaque), `reason`, `seq`, `checked`, and counts. No personal data appears in these
lines by construction (INV-12): an audit event carries opaque identifiers, allowlisted argument keys
and constrained values, never a name, a number or a request payload.

`reason` is where the walk stopped:

| `reason`           | Meaning                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `missing-head`     | events exist but the chain head row is gone                        |
| `missing-event`    | the head claims a sequence the events do not reach                 |
| `sequence-gap`     | a committed sequence number is absent                              |
| `previous-hash`    | an event's `prev_hash` does not match its predecessor's `hash`     |
| `payload-mismatch` | a stored column no longer agrees with the stored canonical payload |
| `hash-mismatch`    | the canonical payload does not hash to the stored `hash`           |
| `head-mismatch`    | the chain re-derives but the head records a different final hash   |

`payload-mismatch` and `hash-mismatch` point at a changed row. `sequence-gap`, `missing-event` and
`missing-head` point at a removed one. `previous-hash` points at reordering or an insertion.

## Immediate steps

1. **Do not repair the chain.** Rewriting rows to make the verifier pass destroys the only evidence
   of what happened. The chain is an evidence artefact before it is a health check.
2. Record the alarm line verbatim (tenant, reason, seq, checked) in the incident.
3. Re-run the verifier for confirmation and to get the current picture:
   ```
   pnpm db:verify-audit
   ```
   If it reports `audit.chain.run.skipped`, a previous sweep still holds the advisory lock — find
   and end that process first rather than forcing a second one.
   It is read-only and safe to run repeatedly. The break is deterministic: a second clean result
   means the first was a defect in the verifier, which is itself a SEV2 finding.
4. Establish the affected range. `checked` is the last sound sequence and `seq` is where it broke,
   so events after `checked` for that tenant are the ones in question.
5. Determine who could have written those rows: database audit logs, recent restores, recent manual
   sessions, recent deploys of the writer function.

## What is in and out of the trust boundary

ADR-0017 states the limit plainly: until an external immutable anchor exists, an actor who can
rewrite **both** the events and the head can forge a consistent replacement chain, which this
verifier would report as sound. What the chain detects is accidental corruption and unauthorised
runtime mutation. A clean verifier run is therefore evidence, not proof, and the incident review
should say which of the two it is relying on.

## Escalation

A confirmed `audit.chain.broken` is a personal-data integrity incident until shown otherwise, so it
follows the security incident path rather than the availability one, and the founder decides on any
Art. 33 GDPR notification. Preserve a snapshot of the affected tenant's `audit_events` and
`audit_heads` rows before any remediation.

## An incomplete sweep

`audit.chain.run.incomplete` means the sweep stopped claiming pages because its wall-clock deadline
fired, with `unreached` tenants never examined. Those chains are unverified — not sound, not broken.

The shortfall is counted from the register rather than from the tenants the sweep happened to claim,
because the worklist cannot report on what was never drained from it. If `unreached` is `0` **and**
the run still failed, the count itself could not be established (typically a revoked grant on
`app.count_audit_chains`): completeness is unknown, which fails closed.

1. Re-run the sweep. A single overrun on a slow day needs no more than that.
2. If it recurs, the sweep is now longer than its interval. `MOIN_AUDIT_SWEEP_DEADLINE_MS` raises
   the deadline, but that is a stopgap: full verification is O(every event that has ever existed),
   so the real answer is a reviewed checkpointing design, which trades tamper-detection latency for
   cost and needs its own decision.
3. Never widen the deadline to make the alarm stop without recording why.

## Checking the arguments as well as the chain

The chain proves the trail has not been altered. It says nothing about what the trail _contains_,
which is what `pnpm check:audit-arguments` is for: every stored argument must be a registered key
with a reviewed value kind, and the only string-valued kind is `uuid`. Run it alongside a chain
incident, because a restore that broke a chain is exactly the kind of event that also writes rows
the reviewed writer would have refused.

It exits non-zero if it inspected nothing, and it also refuses to pass while any provisioned tenant
is missing from the register: a tenant outside the register is outside the scan, so nothing is proven
about what is stored under it. Both are deliberate — the first version of the check returned zero
rows under every production role and printed a reassuring sentence, and the second walked only the
register and never noticed a tenant that was not in it.

Values are validated against their registered kind, not merely against being registered. A
`uuid`-kind argument holding a boolean, a `boolean`-kind argument holding a UUID string, and a
`count` outside its bounds are all findings; a kind with no validator fails closed.

## Scheduling

The verifier is a scheduled daily task. Its trigger and the CloudWatch alarms that match these
lines are Terraform-managed (P05/P15) and are **not** yet provisioned — until they are, this runbook
is reached by running the command manually. That gap is recorded on P06.10.05 as
`WAITING_FOR_EXTERNAL`, not as done.

Two things to configure when they are:

- **Alarm on absence, not only on the lines above.** No `audit.chain.run.completed` line within a
  day is itself an incident: a sweep killed by the scheduler emits nothing, and silence is
  indistinguishable from a healthy day.
- **The sweep re-derives every event that has ever existed**, so its runtime grows with the trail.
  It stops claiming new pages after 30 minutes and reports the tenants it did not reach as
  `unchecked`. When that starts happening regularly the answer is a reviewed checkpointing design —
  which trades tamper-detection latency for cost and so needs its own decision — not a longer
  deadline.
