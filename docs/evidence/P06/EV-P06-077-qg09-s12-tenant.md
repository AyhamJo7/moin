# EV-P06-077: QG-09 §12 session-tenant review (gemini static): OK TO MERGE; L1/L2 only; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-077 |
| Item | P06.03.02 |
| Date (UTC) | 2026-10-09 |
| Commit | `60a5ad8ed80b05d39d9da31f2c8ee7d93b0a23c7` (review base `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by gemini-3.8-flash (review pane) of the §12 merge range (`70031d7` tenant-from-session): `apps/server/src/modules/platform/tenant-scope.ts:45-54`, `apps/server/src/modules/identity-access/http/members.controller.ts:82-84`, guard/interceptor ordering. Each cited line re-verified by orchestrator direct read below. Base evidence on file: EV-P06-060. No fix implemented. |
| Result | OK TO MERGE (reviewer verdict — distinct from founder acceptance; founder verdict PENDING). No HIGH, no MEDIUM. Open findings below, all STATIC/UNVERIFIED. |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | gemini-3.8-flash static (security+architecture); founder verdict PENDING |

## Review target SHA

`70031d7` test(auth): prove tenant comes from session only (#49), as merged on
`origin/main` (base EV-P06-060).

## Findings (severity-indexed; all STATIC)

- **L1 (LOW, arch): `withRequestTenant` error message misattributes missing scope solely to the guard.** `tenant-scope.ts:50-52` throws `'no tenant scope: the route is not guarded by SessionMembershipGuard'` whenever `storage.getStore()` is undefined — but a route with the guard present and the `TenantContextInterceptor` missing fails identically. Verified: lines 50-52 exact text; interceptor pairing is decorator-convention (`members.controller.ts:82-84` shows both attached). Proposed: mention both — `'... requires SessionMembershipGuard and TenantContextInterceptor'`.
- **L2 (LOW, arch): interceptor attachment relies on controller-level decorator convention.** Guard + interceptor must be manually paired on every tenant controller (`members.controller.ts:82-84`); no composite decorator or lint rule enforces the pair. Verified: class-level `@UseGuards(...)` + `@UseInterceptors(TenantContextInterceptor)` adjacent lines. Fails closed at runtime if omitted. Proposed: `UseTenantSession()` composite decorator applying both.

Passes (sound, no finding): forged org header/query/body all disregarded (3/3 interceptor mutants killed, EV-P06-060); single-membership binding with fail-closed ambiguous_organisation; mutation paths bypass/invalidate the 30 s read cache; zero migrations in range.

## Disposition

None fixed in this change (documentation task only). Founder verdict PENDING for §12. OK TO MERGE is the reviewer's static verdict, not founder acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
