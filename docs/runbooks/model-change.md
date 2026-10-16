# Runbook — Model change (P15.09.01, P10.15.03)

- **Owner:** on-call (the founder until P15.10 assigns otherwise)

## Trigger

Planned model or prompt version change, or eval drift alarm.

## Symptom

None (planned) — or rising `ai.wording.rejected` / eval drift (reactive).

## Steps

1. Shadow compare: run the new version set in parallel on async purposes;
   compare outputs, use none of them (`shadowCompares`).
2. Stage the new version set behind a flag; run the eval harness.
3. Canary enablement: flip a single tenant (canary); promote to all only on
   canary pass (`canaryGates`) — otherwise roll back.
4. Roll out tenant by tenant; keep the previous version set pinned.
5. Rollback execution: restore the previous version set (`rollbackRestores`);
   on regression mid-rollout: `flags set <flag> off --reason "<incident ref>"`
   per [kill-switches](kill-switches.md) — instant rollback.

## Verify

Eval green; shadow outputs match; canary tenant green before promotion;
wording rejects at baseline; no owner 👎 spike for 48 h.
