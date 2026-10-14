# Runbook — DLQ replay (P15.09.01)

- **Owner:** on-call (the founder until P15.10 assigns otherwise)

## Trigger

`sqs.dlq.depth > 0` alarm (SEV2), or the DLQ drain check in the ops CLI.

## Symptom

Failed jobs or notifications accumulate in the dead-letter queue; affected
tasks or notifications never reach the owner.

## Steps

1. `jobs dlq list` — confirm depth and oldest message age.
2. Inspect the failure reason on the head message (poison payload vs
   downstream outage).
3. Fix the cause first (deploy, provider recovery, flag flip) — never replay
   into a still-broken consumer.
4. `jobs dlq replay --reason "<incident ref>"` — audited, bounded replay.
5. Watch `sqs.dlq.depth` return to 0 and the retried metric recover.

## Verify

DLQ depth 0; retried jobs complete; delivery receipts show `sent`.
