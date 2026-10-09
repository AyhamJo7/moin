# EV-P06-078: QG-09 §13 resolve_route review (gemini static): OK TO MERGE; L1/L2 only; founder verdict PENDING

| Field | Value |
|---|---|
| Evidence ID | EV-P06-078 |
| Item | P06.03.04 |
| Date (UTC) | 2026-10-09 |
| Commit | `60a5ad8ed80b05d39d9da31f2c8ee7d93b0a23c7` (review base `origin/main`; this docs-only change implements nothing) |
| Environment | local (static reviewer read; no DB, no tests run) |
| Command / procedure | Static read by gemini-3.8-flash (review pane) of the §13 merge range (`e73482d` resolve_route): `packages/db/migrations/0026_number_routes.sql:30-93`, DEFINER `app.resolve_route`, REVOKE posture, FK design. Each cited line re-verified by orchestrator direct read below. Base evidence on file: EV-P06-065. No fix implemented. |
| Result | OK TO MERGE (reviewer verdict — distinct from founder acceptance; founder verdict PENDING). No HIGH, no MEDIUM. Open findings below, all STATIC/UNVERIFIED. |
| CI run / artifact | not applicable (review record, no code change) |
| Reviewer | gemini-3.8-flash static (security+architecture); founder verdict PENDING |

## Review target SHA

`e73482d` feat(p06): global number_routes with resolve_route tenant resolution (#57), as
merged on `origin/main` (base EV-P06-065).

## Findings (severity-indexed; all STATIC)

- **L1 (LOW, arch): missing index on referencing FK `route_organisation_id`.** `0026:43-51`: `route_organisation_id` references `organisations(id) ON DELETE CASCADE` and pairs into the composite FK to `locations`, but the only index is the `e164` PK. Verified: table DDL lines 43-51 (PK on `e164`, no secondary index); composite FK at 50-51. Org/location deletes cascade-scan the table. Proposed: `CREATE INDEX number_routes_org_loc_idx ON number_routes (route_organisation_id, location_id)` in a future migration.
- **L2 (LOW, sec/arch): unindexed non-E.164 inputs hit the B-tree needlessly.** `0026:84-93`: `resolve_route(p_e164)` queries `WHERE r.e164 = p_e164` with no format short-circuit; garbage input does a wasted index probe. Verified: function body at 84-93, exact-match `WHERE`, no `IF p_e164 !~` guard; normalisation is caller's job per the 0026 header comment (lines 35-39). Proposed: E.164 short-circuit `RETURN` in the function, or normalize in the voice adapter before calling.

Passes (sound, no finding): global-table exemption by necessity (resolution precedes tenancy; `route_organisation_id` naming dodges the RLS applicator); DEFINER minimal return `(organisation_id, location_id)` with active-only filter (quarantined/unknown indistinguishable); release-is-DELETE (no lingering association, GDPR minimization); full REVOKE from all runtime roles incl. `moin_app`; STABLE + locked search_path; catalog digest pinned; additive migration.

## Disposition

None fixed in this change (documentation task only). Founder verdict PENDING for §13. OK TO MERGE is the reviewer's static verdict, not founder acceptance — P06 stays READY_FOR_REVIEW at most, nothing here marks any item VERIFIED.

Sensitive material is stored by reference only (PLAN.md evidence rules).
