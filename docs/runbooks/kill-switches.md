# Runbook — Kill switches (P15.09.01)

- **Owner:** on-call (the founder until P15.10 assigns otherwise)

## Trigger

AI misbehaviour, cost spike, or provider incident requiring an immediate stop.

## Symptom

Wrong actions proposed, runaway cost, or abusive traffic through the AI path.

## Steps

1. `flags set <flag> off --reason "<incident ref>"` — audited, reason required.
2. Confirm the flag override is effective (behaviour stops within one sweep).
3. Diagnose with the [call debug timeline](../..) via the ops CLI — never by
   reading raw logs for caller content.
4. Re-enable only after the fix is verified in staging.

## Verify

Flag state off in production; offending behaviour absent for 30 min.
