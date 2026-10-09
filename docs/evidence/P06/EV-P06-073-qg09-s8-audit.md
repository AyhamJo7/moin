# EV-P06-073: QG-09 §8 audit-adoption review (gemini-3.8-flash static): OK TO MERGE; M1/M2 + L1/L2 open; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-073 |
| Item | P06.10.03 |
| Date (UTC) | 2026-10-09 |
| Commit | `e9b9ea44aef2a316ec431c52b63e57ed2ccef483` (review base `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by gemini-3.8-flash (review pane) of the §8 merge range (audit writer adoption #45, `393089a`, plus correlation-threading consumers). Working context: base EV-P06-056. No code executed, no fix implemented — documentation of reviewer output only. Prior gateway-503 BLOCKER (subagent reviewer pair unrunnable) resolved via this Gemini fallback; the BLOCKER rows stay in PROGRESS as history. |
| Result | OK TO MERGE (reviewer verdict — distinct from founder acceptance; founder verdict PENDING). No HIGH. Open findings below, all STATIC/UNVERIFIED (no runtime proof claimed). |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | gemini-3.8-flash (static); founder verdict PENDING |

## Reviewed SHA

`393089a` feat(audit): adopt writer with correlation and argument allowlists (#45), as merged
on `origin/main` (base EV-P06-056).

## Findings (severity-indexed; all STATIC)

No HIGH. Verdict OK TO MERGE means: no finding blocks the merge on its own in the
reviewer's static judgement; the items below are follow-up hardening, founder to confirm.

- **M1 (MEDIUM, sec): `x-correlation-id` UUID spoofing in the audit log.**
  `apps/server/src/modules/platform/member-queries.ts:31`
  (`auditCorrelationId()`): a caller-supplied header value that parses as a UUID is
  written into `audit_events.correlation_id`. Two requests sharing one forged id then
  read as one request in any correlation-scoped audit query. STATIC. Proposed: use the
  server-generated `requestId`, or sign the header — never persist a caller-chosen value
  as a correlation key. (Direct-read note: the UUID-shape gate at least keeps malformed
  input from failing the write — the finding is about spoofability, not injectability.)
- **M2 (MEDIUM, arch/sec): unchecked `correlationId` in `withTenant` causes 22P02 SQL
  aborts.** `packages/db/src/tenant.ts:160`: `set_config('app.correlation_id', value)`
  stores any string, but the read sites cast with
  `NULLIF(current_setting(...), '')::uuid` (`0020_audit_adoption.sql:70,127`) — a
  non-UUID value aborts the writing transaction with `invalid_text_representation`.
  STATIC. (Direct-read note: the app-layer `auditCorrelationId()` gate normally supplies
  a UUID or the server requestId, so the abort needs a caller that passes
  `correlationId` straight into `withTenant` options; the hardening is to validate UUID
  shape before `set_config`.) Proposed: validate UUID before `set_config`, falling back
  to `''`/requestId like the app layer.
- **L1 (LOW, arch): `withRequestTenant` doesn't thread `correlationId`.**
  `apps/server/src/modules/platform/tenant-scope.ts:53`: passes `{ actorId }` only, so
  requests through this path write audit rows with NULL correlation (future NULL audit
  rows where the invariant wants one id per request). STATIC. Proposed: thread
  `scope.correlationId` (or the request id) alongside `actorId`.
- **L2 (LOW, arch): 0020/0021 `CREATE OR REPLACE` without explicit REVOKE/GRANT
  restatement.** The replacement bodies rely on surviving ACLs rather than restating
  them. STATIC. Proposed: restate `REVOKE ALL ... FROM PUBLIC` + exact `GRANT EXECUTE`
  after each `CREATE OR REPLACE` (same pattern as the function-creation migrations).

## Disposition

None fixed in this change (documentation task only; §8 fixes ride a later hardening PR).
Founder verdict PENDING for §8. OK TO MERGE is the reviewer's static verdict, not founder
acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
