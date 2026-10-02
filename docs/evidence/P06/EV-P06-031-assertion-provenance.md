# EV-P06-031: Assertion evidence taken from the matcher boundary in-process rather than from the serialized thrown value, which a plain object literal and a toJSON spoof had both defeated

| Field | Value |
|---|---|
| Evidence ID | EV-P06-031 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 18:27 UTC |
| Commit | `96a5dadcfe30ad84e9e7e3d862390cb832907999` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 3.0 s); `pnpm lint` → pass (exit 0, 2.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 1.0 s); `pnpm test` → pass (exit 0, 5.1 s); `pnpm test:integration` → pass (exit 0, 9.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

The fifth independent QG-09 review accepted the audit and epoch architecture and found no new
database or security defect. One HIGH blocker remained: `KILLED_ASSERTION` could still be forged
from a serialized thrown object. It was reproduced before anything was changed.

## The blocker, reproduced

Run through the then-current reporter against real Vitest
(`scripts/__fixtures__/reporter/spoof.fixture.ts`, child process, production reporter):

| Thrown | Previous verdict |
| --- | --- |
| `{ name: 'AssertionError', expected: 1, actual: 2, showDiff: true, ok: false }` — a plain **object literal** | **`ASSERTION`** |
| an ordinary `Error` whose `toJSON()` returns that shape | **`ASSERTION`** |

Both would have become `KILLED_ASSERTION` with no matcher having failed. The previous model required
`expectCalls > 0` plus the absence of the `constructor`/`toString` keys Vitest's serializer adds to
foreign errors — and a plain object is not an `Error`, so it gets neither key, while `toJSON()`
replaces the serialized shape wholesale. My earlier measurement of those markers had only covered
`Error` subclasses, which is exactly the kind of gap a heuristic hides.

This was the fourth generation of this decision to be spoofed:

| Generation | Authority | How it fell |
| --- | --- | --- |
| 1 | exit code | an unreachable database reported every variant killed |
| 2 | message text | `database connection refused while executing toThrow assertion` counted |
| 3 | `name` + `expected`/`actual`/`showDiff`/`ok` | an `Error` decorated with those four fields counted |
| 4 | the above plus serializer markers | a plain object literal, and a `toJSON` spoof |

The conclusion is not that generation 4's field list was too short. **A thrown value is data authored
by the code under test**, so no property of it can be authority for what the test framework did.
There is no tighter heuristic, and none is used now.

## The provenance architecture

`scripts/mutation-evidence-probe.ts`, a `setupFiles` entry in **both** Vitest projects.

**Matcher-boundary instrumentation.** Every function on Vitest's `Assertion.prototype` is replaced
by a wrapper that appends a `MATCHER_FAILURE` record when that matcher throws. Measured: 185 own
properties, the matchers among them writable and configurable; `not` returns an assertion with the
same prototype so it needs no wrapper. The `rejects` and `resolves` getters are wrapped too, because
Vitest raises "promise resolved instead of rejecting" from inside its own async chain **without**
running a matcher — still its assertion machinery failing rather than the code under test throwing,
and a shape several real kills depend on.

That wrapper is the only code that can create a record. `throw` does not call a matcher, so no throw
of any shape can create one. The property is architectural: reaching the record requires going
*through* the machinery, not resembling its output.

**Invocation windows.** `beforeEach` opens a window with a fresh id and the canonical identity read
from `context.task`; `afterEach` closes it and emits only the records made inside it, for that
identity. One thrown value counts once however many wrappers it passes through, deduplicated by
object identity — a matcher calling another matcher is one failure, not two.

| Requirement | How it is met |
| --- | --- |
| produced inside the test process | a setup file, in the worker |
| tied to canonical identity | from `context.task`, never `expect.getState()` — measured: under `it.concurrent` the module-level state reports *another* test's `currentTestName`, while only the context-local `expect` is right |
| tied to this invocation | fresh id per `beforeEach`, including per retry |
| cannot be made by throwing | one writer, and it is a matcher wrapper |
| reset for every test | the window's first sequence number excludes everything earlier |
| stale events rejected | counted in `rejected`, which makes the invocation non-evidence |
| setup/hook failures cannot fabricate it | a failing `afterEach` stops the probe completing, so no record is attached at all; a hook error also outranks every test verdict in the classifier |
| parameterized cases distinct | identity is the full generated name |
| concurrency cannot cross-contaminate | overlapping windows are **detected** and both marked `suspect`; the probe declines to attribute rather than guessing |

**The probe writes last.** A test can reach `task.meta` and write a record. The fixtures do exactly
that — right version, right event, right identity, one failure, no suspicion, and the thrown value
stamped with the very token the record vouches for — and a setup file's `afterEach` runs after the
body and overwrites it. Forgery is not hidden from; it is overwritten.

**One narrow, one-directional use of the error.** The wrapper stamps an enumerable,
invocation-scoped token on the value it rethrows, and the reporter requires the failing test to
carry one of the invocation's tokens. This answers only *did the earned failure propagate* — a test
that catches `expect(1).toBe(2)` and then throws an ordinary error has the event but not the token,
and "the mutation was rejected by an assertion" would be false of it. It can only **remove**
evidence: without the event nothing reads a token, so no token can create a verdict. It is a
correlation mechanism, not a secret, and is not described as cryptographic.

`assertionCalls` survives as a **diagnostic**. Measured: case 4 below reports `expectCalls: 2` and
`matcherFailures: 0`.

## The final rule

`KILLED_ASSERTION` requires all thirteen: pristine baseline passed cleanly · a report version this
classifier understands · exactly one test carrying the exact `{ file, fullName }` identity · it
executed · it failed · a trusted matcher-failure event for this invocation · that event bound to this
exact identity, with exactly one failure, whose token propagated · no unrelated test failure · no
setup failure · no hook failure · no reporter failure · no timeout · no load/build failure · nothing
rejected or suspect in the probe state. The serialized error is no part of the proof of the event.

## Mandatory real-Vitest regressions

`scripts/mutation-reporter.realvitest.test.ts` — **20 tests**, spawning a child Vitest with **the
production probe, the production reporter and the production `categoriseTest`** over real fixtures.
Nothing is reimplemented in the test.

| # | Case | Result |
| --- | --- | --- |
| 1 | plain thrown assertion-shaped object | `ERROR` · event `NONE` · 0 failures |
| 2 | `Error` with a `toJSON()` assertion spoof | `ERROR` · 0 failures |
| 3 | decorated `Error` | `ERROR` |
| 4 | successful `expect` then plain throw | `ERROR` · `expectCalls: 2` · 0 failures |
| 5 | successful expects then the `toJSON` error | `ERROR` |
| 6 | Node's own `assert.AssertionError` | `ERROR` — another library asserting is not a Vitest matcher failing |
| 7 | genuine matcher failure | **`ASSERTION`** · 1 failure · token propagated · token contains the invocation id |
| 7b | `not`, `resolves`, `rejects`, and `rejects` on a resolving promise | **`ASSERTION`** — every style the corpus uses |
| 8 | trusted assertion beside an unrelated failure | `ASSERTION` per test; the run is disqualified by the classifier (`UNRELATED_FAILURE`) |
| 9 | trusted assertion plus an `afterEach` failure | `UNKNOWN` — probe never completes |
| 10 | forged probe record, complete and token-stamped | `ERROR` — overwritten, `invocationId` is not the forged one |
| 11 | forged record naming another test | `ERROR` — overwritten, identity is this test's |
| 12 | two matcher failures in one test | `UNKNOWN` — fails closed |
| 12b | a matcher failure the test swallowed, then another failure | `ERROR` — event present, token absent |
| — | concurrent tests failing matchers | `UNKNOWN` both — overlap detected |
| — | timeout · `beforeAll` failure · same name in two modules | `TIMEOUT` · hook error, test not executed · distinguished by `file` |

## Anchor uniqueness at application time

`applyMutation` in `scripts/mutation-sweep.ts` is now the single place a variant is injected, used by
both the sweep and `--validate`, so validation can be neither more permissive than execution nor
less. It refuses an anchor occurring **zero** times, an anchor occurring **more than once**, an empty
anchor, and a replacement identical to its anchor; every refusal is `INVALID_MUTANT`, and nothing is
mutated. The splice is positional (`slice` + `slice`) rather than `String.prototype.replace`, which
retires the `$$`-interpretation defect by construction instead of by remembering to pass a function.

`scripts/mutation-sweep.test.ts` — **9 tests**: zero anchors, exactly one, a duplicate (2 and 4
occurrences), a replacement identical to the anchor (unique and duplicate anchor), an empty anchor, a
literal SQL body containing `$$` and `$&`, and the byte-exactness of the surrounding file.

## Self-test count

**82 harness tests**, all passing: 30 classifier (`mutation-outcome.test.ts`), 16 reporter
(`mutation-reporter.test.ts`), 20 real-Vitest, 9 mutation application, 7 probe wiring and provenance
(`mutation-evidence-probe.test.ts`, which asserts the probe is loaded by both projects and that the
verdict function mentions none of `foreignMarkers`, `assertionFields`, `'AssertionError'`,
`expected`, `showDiff`, `constructor`, `toString`, `stack` or `expectCalls`).

## Preserved, not regressed

Exact `{ file, fullName }` identity with `===` on both halves; `0 → NO_TEST_MATCH`,
`>1 → AMBIGUOUS_TEST_IDENTITY`; `unrelatedFailures === 0` as a hard requirement; missing, malformed,
truncated and wrong-version reporter output all non-evidence. Each is still mutation-proven
(`H20`–`H25`, `H3`).

## Mutation distribution at this HEAD

Regenerated end to end, twice, with identical results. **`77/2 over 79` is superseded.**

**`KILLED_ASSERTION: 90` · `INFRA_FAILURE: 2`, over 92 variants** —
`docs/verification/audit-mutation-report.md`.

**25 harness variants (`H1`–`H25`), all `KILLED_ASSERTION`:**

| Variant | Conjunct removed |
| --- | --- |
| `H1-reporter-trusts-serialized-assertion-shape` | the rejected heuristic restored whole — killed by the real-Vitest plain-object case |
| `H2-reporter-skips-the-trusted-event` | provenance required at all |
| `H3-reporter-accepts-a-stale-probe-version` | contract version pinning |
| `H4-reporter-ignores-probe-suspicion` | the probe's own refusal to vouch |
| `H5-reporter-ignores-rejected-events` | discarded records make the window untrustworthy |
| `H6-reporter-weakens-the-event-identity` | both halves of the identity |
| `H7-reporter-accepts-ambiguous-events` | exactly one matcher failure |
| `H8-reporter-accepts-a-swallowed-assertion` | the earned failure must propagate |
| `H9-reporter-accepts-any-token` | the token must be this invocation's |
| `H10-reporter-prefers-assertion-over-timeout` | a hung test is not an assertion |
| `H11-probe-treats-expect-calls-as-provenance` | `assertionCalls` is not failure provenance |
| `H12-probe-token-is-not-invocation-scoped` | tokens are scoped, so replay is detectable |
| `H13-probe-ignores-overlapping-invocations` | concurrency is refused, not attributed |
| `H14-probe-lets-a-forged-record-stand` | the probe is the last writer of its key |
| `H15-probe-window-admits-the-previous-invocation` | the window excludes earlier records |
| `H16`–`H19` (sweep) | anchor uniqueness at application time, no-op mutants, missing anchors, literal splicing |
| `H20`–`H25` (classifier) | error-name trust, module identity, exact names, uniqueness, run cleanliness, hook precedence |

**Disposition of every non-`KILLED_ASSERTION` outcome.** Two, both `INFRA_FAILURE`, both kept as
non-evidence as the review asked, and both with their recorded reason **updated to the new model**:

| Variant | Measured |
| --- | --- |
| `N8-backfill-removed` | The killing test is the one that *applies* `0010`. The migration's own guard fires — `audit chain register backfill covered 0 of 3 organisation(s)` — and rolls back, so the test fails on that thrown error after 2 real `expect` calls and **no matcher failure**. No trusted event, so no evidence. |
| `P8-sequence-backfill-removed` | The same in `0011`: `column "registration_seq" … contains null values`, after 4 real `expect` calls and no matcher failure. The `NOT NULL` constraint is the control. |

Both defects *are* detected, by a guard inside a migration, which is a stronger control than a test.
Neither is assertion evidence. Not counted, not rounded up to 92.

**No survivors**, and no variant was removed, retargeted or had its test weakened to improve the
number.

## Two limits, stated rather than hidden

- The sweep hands the **mutated reporter** to the mutated run. That is sound only because every
  `H*` reporter variant is a *relaxation*: a genuine matcher failure still types `ASSERTION`, so the
  kill stays observable, while a tightening would fail closed into a non-evidence outcome rather
  than report a false kill.
- A probe mutation broad enough to stop **any** test producing `ASSERTION` cannot be killed by an
  assertion, because the harness could not then report its own kill. Three candidate variants were
  narrowed for exactly this reason — the probe variants in the manifest keep the parent run's own
  record valid — and one candidate (making the token non-enumerable) was dropped rather than left in
  the manifest as a permanent non-evidence row. The properties they would have covered are asserted
  directly by the real-Vitest suite instead.

## Verified at this HEAD

- `python3 .claude/bin/gates.py full` → **PASS 14/14** at `96a5dadcfe` on a clean tree, evidence
  `.git/claude-evidence/20261001T182553Z-full.json`. The matcher instrumentation is loaded by every
  unit and integration test in the repository, and the whole suite passes unchanged.
- `node scripts/mutation-sweep.ts --validate` → 92 variants; every anchor unique and resolving,
  every identity collected exactly once, 2 table-driven names deferred to the baseline gate.
- Harness self-tests: 82 passed.
- Standalone, against a freshly-seeded database: `audit-chain-epoch` 8/8, `audit-chain-population`
  10/10, `audit-chain-backfill` 2/2, `audit-verification` 24/24, `audit` 11/11, `cli-verify-audit`
  8/8, `check-audit-arguments` 27/27, `check-rls-catalog` 29/29.
- `control_plane_check.py` → OK; `evidence.py check` → 113 OK, 0 problems.
- `git diff --check` clean; no mutated source left in the tree.

## Not changed, deliberately

`git diff bd98c63..HEAD` touches **no file under `packages/db/` or `apps/`**. The transactional
singleton epoch, commit-order serialization, high-water semantics, registration bypass controls,
verifier and scanner traversal, migration and backfill, and the privileged-function controls are
byte-identical. No auth or OIDC change; the privacy checker was not expanded.

ADR-0017 remains **PROPOSED** with its five residuals unchanged. P06.10.03 remains open. P06.10.05
remains `WAITING_FOR_EXTERNAL` on EXT-09. P06.10 is `IN_PROGRESS`, not complete, and P06.10.07 is
`READY_FOR_REVIEW` — never `VERIFIED` by the implementor. PR #31 stays a draft.
