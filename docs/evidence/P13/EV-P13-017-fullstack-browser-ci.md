# EV-P13-017: M2C: the sign-in, simulated call, live Heute, Erledigt and replay browser acceptance runs in GitHub CI against real PostgreSQL and Keycloak (10 of 10, 15.9 s arrival); removing the live-update wiring fails the job

| Field | Value |
|---|---|
| Evidence ID | EV-P13-017 |
| Item | P13.02.04 |
| Date (UTC) | 2026-10-18 03:50 UTC |
| Commit | `9de05d5191d67f592092e3756056b07ff84c2e92` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.8 s); `pnpm lint` → pass (exit 0, 3.3 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.0 s); `pnpm test:integration` → pass (exit 0, 28.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | see "CI evidence"; remediation head run in the PR description |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

Gate re-run for the review remediation: `gates.py full` PASS 14/14 on the clean tree at `9de05d5`
(code fingerprint `0d40743fcec1378e3c5077f0f8c058788f6059c82bccb1af3edb79b2716be286`, evidence file
`20261018T034937Z-full.json`; an earlier attempt failed `integration` only because the local
PostgreSQL and Keycloak had been stopped, and was repeated with the stack up). The command list in
the row above is the one that run executed; the earlier `cc07c07` result is not reused.

## What this record shows

Mission M2C, branch `ci/p02-05-fullstack-browser-acceptance` from `main` at `cbef5f5` (M2B #237
squash-merged; #234, #235, #236 also merged, so no open PR overlapped). It adds one mandatory job,
`e2e-slice`, to `.github/workflows/verify.yml` and puts it in the `verify` aggregate's `needs`, so
the existing required `verify` check covers it with no ruleset change. No application code changed.

**Before.** The PR `e2e` job ran only `apps/web/e2e/smoke.spec.ts` (Chromium smoke and axe, no API,
no database, no sign-in). The vertical-slice suite (`e2e/vertical-slice/today-callback.spec.ts`,
`playwright.slice.config.ts`) needed Keycloak and PostgreSQL and ran only on a developer machine.

**What the job runs.** PostgreSQL (the pinned pgvector image as a service container), the
`NOBYPASSRLS` application roles (the same role SQL as the `integration` and `rls-catalog` jobs),
Keycloak from the compose file with the committed realm, the compiled API (`dist/main-api.js`), and
the owner app's standalone server built with the loopback `/api/*` proxy. The spec builds a migrated
template database if none exists, creates a fresh test database from it, stages two tenants, the
owner's `users` row and the number routes through the fixture role, signs in through Keycloak's own
login form, and drives Chromium. Only the call itself is simulated, through the bearer-protected
test entry point. All credentials are the committed `ci-only-not-a-secret` placeholders and the
Keycloak fixture realm; no GitHub secret is used (INV-15, INV-16).

**It cannot pass by testing nothing.** `scripts/check-slice-report.ts` reads Playwright's JSON
report and fails the step unless every one of the ten required test titles ran and passed, with no
skipped, flaky or failed test (retries are off). The step runs `if: always()` under `shell: bash`
(pipefail), so the checker's exit code survives the pipe into the job summary; both reviews found
that the first version lost it, and it was fixed (`bash -e` exits 0 and `bash -eo pipefail` exits 1
for the same bad report, shown locally). The job has no `continue-on-error`.

## Acceptance matrix (all in a real browser, real PostgreSQL, real Keycloak)

| Step | Test |
| --- | --- |
| Sign in through Keycloak; Heute; call; task persisted; callback card with caller and time; other tenant's task absent; axe; API restart | `a simulated callback call reaches the owner on Heute and stays there` |
| Erledigt persists as done/4 with three audit events by the owner; stays done after reload and an API restart; replay reopens nothing | `the owner completes a callback with Erledigt and it stays completed` |
| Already-open Heute shows a new callback by itself, once, without reload, focus kept, 60 s limit, commit-to-render measured | `a callback committed while Heute is open appears by itself, once, without a reload` |
| Completion reaches a second independently signed-in session; a call replay does not reopen it | `a completion reaches another open session, and a replay of the call does not reopen it` |
| Outage keeps the list, no error banner; reconciles when the network returns | `an outage leaves the list as it is, and the page reconciles when the network returns` |
| Revoked session: signed-out page, no task data | `a revoked session shows the signed-out page and no task data` |
| Stale view conflict, lost answer reconciled or unknown, request never sent, double click once | the four remaining Erledigt tests |

**Not claimed.** There is one Keycloak fixture owner, so no browser session of a second tenant is
authenticated: cross-tenant protection is shown only by the other tenant's task never appearing for
the owner. Cross-tenant API behaviour stays in the integration suite.

## CI evidence (GitHub Actions, run 39090443360, commit `cda55df`)

Job `full-stack browser acceptance (postgres, keycloak)`: success, 4 m 58 s. Playwright: `10 passed
(3.3m)`, project `chromium`, file `e2e/vertical-slice/today-callback.spec.ts`, tests 1–10 listed in
the log. Report check: `10 passed, 0 failed, 0 skipped`. Artifact `e2e-slice` (117 KB, 14 days)
holds the JSON report, timings and process log. The three latencies have different origins and
are not interchangeable:

| Scenario | CI | Local (M2B) | Measured from, to |
| --- | --- | --- | --- |
| Callback arrival on an already-open Heute | 15.93 s | 14.97 s | the task row's `created_at` to the card visible. `created_at` is stamped at transaction start, so this is a conservative approximation of commit-to-render. This is the P13.02.04 healthy-tab arrival measurement. |
| Completion propagation | 15.86 s | 15.36 s | the first session's UI confirmation of Erledigt to the second session's updated list. Not a database commit time. |
| Network recovery | 0.09 s | 0.09 s | connectivity restored in the browser to the updated card visible. Not a database commit time. |

Single runs on one shared clock; the P13.02.04 claim rests only on the first row.

The same job is green on `8b99976` (run 39091402625) after the revert described next.

## Regression sensitivity

- **In CI.** A temporary commit (`6614038`, reverted in `8b99976`; net diff to the green commit
  empty) removed the `LiveToday` mount from `apps/web/app/page.tsx`. Run 39090964507: the job
  failed; tests 7–10 (the live-update tests) failed on `expect(locator).toBeVisible()` after the
  60 s arrival wait while tests 1–6 passed, so the failure is the missing feature, not a setup
  error. The required `verify` check failed with it.
- **Official mutation check.** `mutation_check.py --fix-ref cbef5f5 --fix-paths apps/web/app/page.tsx`
  with the arrival test: KILLED (without the wiring FAIL in 75 s by arrival timeout, with it PASS
  in 46 s).

## Reviews (QG-09)

Security: no Critical/High. Medium M1 (checker exit code lost in the pipe) fixed; M2 (traces and
screenshots are retained and the "synthetic only" assumption is not enforced) accepted: every
credential and token in the run is a committed or per-run random fixture, and traces go to a
separate 7-day artifact on failure only. Low items (Postgres port binding as in the other jobs,
`--with-deps` as in the `e2e` job, title substring matching) accepted. Architecture: High H1 is the
same pipe bug, fixed; M2 (only six of ten tests required) fixed by requiring all ten; timeout
lowered to 20 minutes. Accepted and recorded: the role SQL now exists in three jobs (a shared file
would touch two unrelated required jobs); the 60 s arrival limit is a product claim and is not
loosened for CI (a failure there is a finding, not noise).

## Limits

The job costs about 5 minutes a pull request and runs in parallel with the others. Ports 3000,
3101 and 8080 are fixed, which is safe on a fresh hosted runner. The suite has not run on Firefox,
WebKit or phone viewports. Deployment compatibility stays a separate gate; the M2A warning stands
(the strict Today schema needs the API and the owner app deployed together). One unit-test gate
failed once during this mission and did not reproduce in two further full-gate runs and a
standalone run; its cause is UNVERIFIED.

## Independent review of PR #238 and remediation

**Finding F1 (blocking, independent Codex review of `c90f163`).** The report check accepted a
required test that actually failed. Playwright counts a `test.fail()` test that fails as
`expected`, marks its spec `ok: true` and exits 0, and the first checker read exactly those
indicators. Root cause: it trusted Playwright's classification (`stats.expected`, `spec.ok`)
instead of what each test did. It also accepted a report whose `stats` was replaced by an empty
object, because it read missing counters as zero.

**Reproduced.** Against a genuine Playwright report of a ten-test suite with the acceptance
suite's file, project and titles in which one test calls `test.fail()`
(`scripts/__fixtures__/slice-report/control-test-fail.json`), the old checker printed
"10 passed, 0 failed, 0 skipped" and exited 0; the fixed checker exits 1.

**Fix.** `scripts/check-slice-report.ts` now validates the untrusted JSON before reading it and
accepts a run only if: `stats` holds four non-negative integers, `errors` is an empty array, the
only project is `chromium`; each of the ten exact titles occurs exactly once, in `chromium` and in
`today-callback.spec.ts`, and nothing else occurs; every test has `expectedStatus` "passed", outcome
"expected", `spec.ok` true, none of the `fail`, `skip` or `fixme` annotations, exactly one result
that is `passed` on retry 0 with no errors; and the reported totals equal the totals counted from
the records. Any failure to read or parse the report is a rejection (exit 1, "REJECTED" in the job
summary, never "10 passed"). The workflow is unchanged: the step already runs under
`shell: bash` (pipefail), and `verify` still needs `e2e-slice`.

**Tests.** `scripts/check-slice-report.test.ts`, 29 tests, using the real CI report and five
genuine Playwright control reports (provenance in the fixtures README). Matrix: accept the real CI
report and a genuine all-pass report; reject genuine `test.fail()`, skip, flaky-after-retry and
timeout reports; reject unexpected failure, interrupted, statistics-claim-success-but-record-failed,
empty/missing/nonnumeric/fractional/negative statistics, statistics disagreeing with records,
missing, replaced, duplicated, extra, wrong-project and wrong-file tests, missing or invalid result
records, a passed result that recorded errors, a retry hiding an earlier failure, global errors,
and missing or malformed structure; and run the command itself: exit 0 for the real report, exit 1
with REJECTED for the `test.fail()` report and for an empty, malformed or missing file, and exit 1
through `| tee` under `bash -e -o pipefail` (exit 0 without pipefail, the reason the step sets it).
Targeted mutants of the checker that each remove one guard (expected status, result status, the
annotation list, the single-attempt rule, the statistics cross-check, the project check, global
errors, per-result errors) are each killed by the suite (manual mutants; the repository's
mutation-check tool needs a committed fix and the rewritten module would have failed on missing
exports alone, which would not show sensitivity). One guard that no mutant could reach (a total
count already implied by the identity and outcome checks) was deleted instead of kept untested.

**Finding F3 (nonblocking, fixed).** The latency table now states each measurement's origin, above.

**Finding F2 (nonblocking, inherited, NOT fixed here).** The independent review reports that
`packages/telephony/src/signature/validate.test.ts` ("rejects a tampered signature") replaces the
first signature character with `A`, so a signature that already begins with `A` is unchanged and
the test expects a failure that cannot happen (about 1 in 64 for a random Base64 signature).
The test code does replace the first character with `A` (line 80); I did not reproduce the
failure rate. Unrelated to this checker. Follow-up: a separate narrow PR should replace the first
character with a value guaranteed to differ. Not changed in this PR.
