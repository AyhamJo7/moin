# Runbook — Model change (P15.09.01)

- **Owner:** on-call (the founder until P15.10 assigns otherwise)

## Trigger

Planned model or prompt version change, or eval drift alarm.

## Symptom

None (planned) — or rising `ai.wording.rejected` / eval drift (reactive).

## Steps

1. Stage the new version set behind a flag; run the eval harness.
2. Flip a single tenant (canary) and watch owner feedback + wording rejects.
3. Roll out tenant by tenant; keep the previous version set pinned.
4. On regression: `flags set <flag> off --reason "<incident ref>"` per
   [kill-switches](kill-switches.md) — instant rollback.

## Verify

Eval green; wording rejects at baseline; no owner 👎 spike for 48 h.
