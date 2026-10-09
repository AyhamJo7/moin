# EV-P06-080: QG-09 S9 fix RED: migration 0028 deterministic pick supersede cap bound-ref FOR SHARE plus gate regression plus digest re-pins; static-clean; DB-green pending founder run

| Field | Value |
|---|---|
| Evidence ID | EV-P06-080 |
| Item | P06.11.05 |
| Date (UTC) | 2026-10-09 17:38 UTC |
| Commit | `0db1808b03da81e68ebe3f78f4a092ffe57aba93` |
| Environment | CI |
| Command / procedure | eslint prettier tsc check-migrations plus vitest support-grant-gate |
| Result | RED static-clean DB-green pending |
| CI run / artifact | pending |
| Reviewer | gemini-3.8-flash static pre-review NO BLOCKERS |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What changed (branch fix/qg09-s9-grants vs main 974ff76)

- `packages/db/migrations/0028_support_grant_hardening.sql` (new; 0022 untouched):
  H1 deterministic live-grant pick (`expires_at > clock_timestamp()` predicate +
  `ORDER BY expires_at DESC, created_at DESC, id LIMIT 1`) + supersede prior live
  grants for the same operator+scope on create; H2 emergency reference bound to the
  operator (`op:<subject>:<ticket>`, ticket >= 4 chars), EXECUTE still withheld from
  every runtime role until P06.11.01; M1 at most 5 live grants per (org, scope)
  (`P0001` `grant quota exceeded for tenant`); M2 gate lock `FOR UPDATE` -> `FOR SHARE`.
- `packages/db/src/support-grant-gate.integration.test.ts` (new): H1/H1b/H2/M1/M2
  regression (tenant-scoped fixtures via `app.organisation_id` txn setting, RLS-aware).
- `scripts/check-rls-catalog.ts`: re-pinned digests verified against a scratch DB
  migrated through 0028 — `live_support_grant` 627c5b62b80383a39b182444fbbb672b,
  `create_support_grant` a290be70a4a2a617cb08bcb1f1c944e7,
  `support_emergency_read_memberships` cc6df41fdc8fca1691fedd1ea7217f3a.

## Verification state

- Static clean: eslint + prettier + `tsc --noEmit -p packages/db/tsconfig.json` +
  `check-migrations.ts` (no findings).
- DB-green PENDING: gate test 1/5 in-session (H2 passes; H1/H1b/M1/M2 need migration
  0028 in the template DB, which builds only through the `pnpm test:integration` path
  requiring founder-held DB env). Pre-review (gemini static): NO BLOCKERS on all
  6 checks incl. digest match.
