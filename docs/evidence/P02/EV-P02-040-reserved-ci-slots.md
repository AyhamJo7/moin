# EV-P02-040: Reserved CI jobs for the RLS catalog check and OpenAPI drift

| Field | Value |
|---|---|
| Evidence ID | EV-P02-040 |
| Item | P02.06.05 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | The verify workflow declares rls-catalog and openapi-drift jobs. Each prints the phase that activates it and FAILS if its script appears without the job being wired to run it (`if [ -f scripts/check-rls-catalog.ts ]; then exit 1`). Both are in the aggregate `verify` job needs list, which refuses to pass unless every needed job reports success. |
| Result | PASS. The failing-when-the-script-appears behaviour is the point: a reserved job that silently passes is worse than no job, because it reports green and checks nothing. This way the slot cannot stay dormant once P06.02.04 creates the script. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
