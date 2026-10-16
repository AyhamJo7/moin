# EV-P12-011: M1 hotfix: durable callback acceptance; replay never changes business state; accepted callbacks keep caller number and summary

| Field | Value |
|---|---|
| Evidence ID | EV-P12-011 |
| Item | P12.12.03 |
| Date (UTC) | 2026-10-16 23:35 UTC |
| Commit | `4b8c5b7ba5e4becde5e25c2eb1f4cf15f98d9b6b` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 8.2 s); `pnpm lint` → pass (exit 0, 15.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.4 s); `pnpm typecheck` → pass (exit 0, 7.3 s); `pnpm test` → pass (exit 0, 7.9 s); `pnpm test:integration` → pass (exit 0, 35.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.9 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

A corrective hotfix to the merged M1 slice (#229, `85ad367`). An independent review found two
defects there:

- **F1:** adopting a finaliser fallback left no replay marker, so a redelivery after the owner
  completed the task reopened it and reported a new delivery.
- **F2:** adopting an existing call dropped the supplied caller number and kept the fallback's
  generic title, while the response reported success.

Corrected by migration 0077 `callback_acceptances` and a rewritten `captureCallbackRequest`. Path
and semantics: `docs/development/m1-vertical-slice.md` ("Replay is decided by a durable
acceptance record"). P12.12.03 stays IN_PROGRESS: only the callback intent is built. Nothing is
VERIFIED.

## Regression tests (real PostgreSQL 17 as `moin_app`, nothing mocked)

`apps/server/src/modules/work/callback-today.integration.test.ts`, through the HTTP route and the
authenticated `GET /api/today`:

- an adopted fallback completed or cancelled by the owner stays so on an identical replay, with
  task, call, outcome, acceptance and audit counts unchanged;
- a task the capture created and the owner completed stays completed on replay;
- six concurrent deliveries on an existing call converge on one acceptance;
- the finaliser after acceptance changes nothing, and a replay still holds;
- a distinct later request is not suppressed, and a changed request is a 409;
- an existing call without a number: the number is stored, the fallback retitled, and Today
  shows both to the right tenant only;
- a different recorded number is a 409 with nothing written;
- a retitled task is kept and the summary still lands;
- done and cancelled fallbacks stay closed while a new task carries the request.

`packages/db/src/callback-intake.integration.test.ts`:

- rollback of a failing capture, and of a failure after adoption;
- 12 rounds of capture racing `finaliseInteraction`;
- a pre-0077 created task, and a pre-0077 adopted fallback, both replay without a write;
- live repair-task adoption;
- replay after conversation erasure recreates nothing;
- replay after task erasure;
- RLS: no cross-tenant read or write;
- append-only grants (UPDATE and DELETE are refused with 42501);
- the unique constraint.

## Regression sensitivity

- **Against the merged code:** `callback-intake.ts` from `85ad367` was restored temporarily, with
  only a stub of the new error class so imports resolve, and then restored byte-identical. 19 of
  the new or changed tests fail on it, including the exact F1 sequence and both F2 cases.
- **Against the fix:** 11 targeted mutants of the fixed code, run one at a time and each restored,
  were all killed:
  - replay check skipped;
  - replay check moved after the ingest;
  - pre-0077 outcome rule removed;
  - a changed request accepted;
  - caller number not settled;
  - a different number overwritten;
  - fallback not retitled;
  - an occupied task treated as free;
  - acceptance not recorded;
  - finaliser lock dropped;
  - Today type not derived.

## Reviews

- **QG-09 security, architecture and invariant reviews:** no CRITICAL or HIGH. Their MEDIUMs
  fixed with tests:
  - the replay check now runs before any write (erasure resurrection);
  - pre-0077 captures are recognised;
  - the caller number was removed from the request hash;
  - a retitled task keeps the summary on a new task;
  - a carrier key that cannot collide with older keys;
  - finaliser tasks are recognised by key;
  - an index for SET NULL on erasure.
- **Open, none HIGH:** the derived callback type on Heute only (an ADR for the index); acceptance
  rows outliving erasure (P16); the hash covers the derived summary; pre-0077 calls have no
  tombstone; the shared advisory-lock keyspace.
- **Advisory review:** inconclusive; it returned no structured verdict.
