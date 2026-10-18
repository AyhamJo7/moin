# Report fixtures for `scripts/check-slice-report.ts`

Verbatim Playwright (1.63.0) JSON reporter output, used by `scripts/check-slice-report.test.ts`.
Excluded from Prettier so they stay byte-for-byte what Playwright wrote.

| File | Provenance |
| --- | --- |
| `ci-run-39092001906.json` | The `slice-report.json` of the `e2e-slice` artifact of GitHub Actions run 39092001906 (commit `c90f163`): the real full-stack run, ten tests passed. Unmodified. |
| `control-all-pass.json` | Generated locally: a ten-test suite with the acceptance suite's file name, project and titles, trivial bodies, all passing. |
| `control-test-fail.json` | Same suite, test 4 calls `test.fail()` and then fails. Playwright reports it as expected (`stats.expected` 10, `spec.ok` true, `expectedStatus` "failed") and exits 0: the defect found in review of PR #238. |
| `control-skip.json` | Same suite, test 4 calls `test.skip()`. |
| `control-flaky.json` | Same suite with one retry, test 4 fails first and passes on the retry. |
| `control-timeout.json` | Same suite, test 4 outlives its timeout. |

Regenerate the `control-*` files with `bash scripts/__fixtures__/slice-report/generate-controls.sh`
from the repository root (machine-specific paths are rewritten to `/repo`, `/control`, `/node`).
