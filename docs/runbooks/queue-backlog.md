# Runbook — Queue backlog (P15.09.01)

- **Owner:** on-call (the founder until P15.10 assigns otherwise)

## Trigger

`outbox.lag` or `sqs.age.oldest > 5 min` alarm (SEV1/SEV2).

## Symptom

Outbox or queue depth grows; actions appear late on Today; notifications lag.

## Steps

1. Check worker health and recent deploys (did the consumer stop?).
2. Check provider status (Twilio, LLM, SES) for downstream stalls.
3. Scale or restart the consumer via the deploy pipeline — never by hand on
   the host.
4. If the backlog is poison messages, drain them to the DLQ, then follow
   [dlq-replay](dlq-replay.md).
5. Confirm lag drains monotonically before closing.

## Verify

`outbox.lag` and oldest-message age back under threshold for 15 min.
