# Verification artifacts

## The audit mutation sweep

- **Manifest:** [`audit-mutation-manifest.json`](audit-mutation-manifest.json) — the defective
  variants, as data.
- **Latest report:** [`audit-mutation-report.md`](audit-mutation-report.md) — one row per variant
  with its verdict.
- **Runner:** [`../../scripts/mutation-sweep.ts`](../../scripts/mutation-sweep.ts)
- **Classifier:** [`../../scripts/mutation-outcome.ts`](../../scripts/mutation-outcome.ts)
- **Reporter:** [`../../scripts/mutation-reporter.ts`](../../scripts/mutation-reporter.ts) ·
  **probe:** [`../../scripts/mutation-assertion-probe.ts`](../../scripts/mutation-assertion-probe.ts)
- **Invariants:** INV-01, INV-10, INV-12 · **Review:** QG-09

A test that has never been made to fail is a hope, not a control. Every guard in the audit
subsystem therefore has at least one **defective variant**: a named, minimal edit that would
reintroduce the defect the guard exists to prevent. The sweep applies each one to the working tree,
runs only the test that must catch it, classifies the run structurally, and restores the file
byte-for-byte from memory.

```
node scripts/mutation-sweep.ts --validate     # identities and anchors resolve; runs no tests
node scripts/mutation-sweep.ts                # the full sweep
node scripts/mutation-sweep.ts --only H1-classifier-trusts-error-name
node scripts/mutation-sweep.ts --report docs/verification/audit-mutation-report.md
node scripts/mutation-sweep.ts --json results.json        # machine-readable, for a diff
```

The report is generated, so format it before committing — the `format` gate checks it like any
other file:

```
pnpm exec prettier --write docs/verification/audit-mutation-report.md
```

It needs the local stack (`pnpm dev:up`) and the environment file, like any integration run. The
harness's own variants (`H*`) run in the `unit` project and need neither.

## What `KILLED_ASSERTION` is allowed to mean

The harness is itself a control, and it has been wrong four times, always generously. The verdict is
now defined so that it can only mean **all** of the following:

1. the baseline run of the intended test, on the pristine tree, ran and passed and nothing else in
   that run failed;
2. the mutant run produced a report this classifier's version understands;
3. nothing failed outside a test — no unhandled error, no module error, no hook error;
4. **exactly one** test in the run carries the manifest's canonical identity
   `killingTest: { file, fullName }`, both compared with `===`;
5. that test executed;
6. that test failed;
7. the reporter typed its failure `ASSERTION` from two independent in-process signals;
8. **no other test failed anywhere in the run.**

Anything that cannot be established falls into a named non-evidence outcome. Nothing is inferred
generously.

### How an assertion is identified

The error object cannot be trusted. Vitest serializes errors before a reporter sees them, so by the
time the verdict is made there is no live `Error` and no prototype to test: `instanceof` is
unavailable even inside `onTestFailed`. Everything that survives — `name`, `message`, `expected`,
`actual`, `showDiff`, `ok` — is a mutable own property that any thrown object can set. The previous
generation of this harness accepted exactly that: an ordinary `Error` decorated with
`name = 'AssertionError'` and those four fields was counted as proof an invariant was enforced.

So identity comes from two signals the thrown object cannot touch, and **both** are required:

| Signal                 | Where it comes from                                                                                                                                                        | What it rules out                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `probe.expectCalls`    | `expect.getState().assertionCalls`, read in `beforeEach`/`afterEach` by [`mutation-assertion-probe.ts`](../../scripts/mutation-assertion-probe.ts) inside the test process | a failure where no matcher ever ran — throwing an object cannot raise it |
| `error.foreignMarkers` | Vitest's own serializer, which adds `constructor` and `toString` to every error it does **not** own                                                                        | a decorated foreign object, even one thrown after a real `expect` call   |

Measured on Vitest 5.0.2: a genuine `AssertionError` serializes with exactly
`actual, diff, expected, message, name, ok, operator, showDiff, stack, stacks` and **no**
`constructor` or `toString`; a plain `Error`, a decorated `Error` and Node's own
`assert.AssertionError` all gain both markers. The name and all four matcher fields are required on
top, so the signature is structural rather than nominal.

The second signal is an **observed, undocumented** serializer behaviour, so it is pinned by a test
that spawns a real Vitest run against real fixture suites —
[`mutation-reporter.realvitest.test.ts`](../../scripts/mutation-reporter.realvitest.test.ts) over
[`scripts/__fixtures__/reporter/`](../../scripts/__fixtures__/reporter/). A Vitest upgrade that
changes it fails loudly there instead of silently re-opening the spoof. The fixtures cover a genuine
expectation failure, a spoofed assertion object, passing expectations followed by a decorated throw,
an ordinary thrown error, a timeout, a `beforeAll` failure, an `afterEach` failure, and the same
test name in two different modules.

Message text is used for exactly two things, both of which only ever move a verdict **away** from
evidence: recognising `Test timed out in <n>ms` and recognising a transform or module-resolution
failure.

### How the killing test is identified

A variant names its killing test as a canonical pair:

```json
"killingTest": {
  "file": "packages/db/src/audit-verification.integration.test.ts",
  "fullName": "the sweep > refuses to report a partial run as sound"
}
```

Both are compared exactly. There is no `includes`, no prefix match, no name-only match. The previous
version used `fullName.includes(expectedTest)` with no module identity, which was unsound in three
separate ways: a same-named test in another file could claim the kill; two tests could match at once
and the first was taken; and `"rejects invalid chain"` matched `"rejects invalid chain after retry"`.
Zero matches is `NO_TEST_MATCH`, more than one is `AMBIGUOUS_TEST_IDENTITY`, and the baseline and
mutant runs must resolve the same single identity. A parameterized test must be named by one
concrete generated case.

`--validate` rejects a malformed or ambiguous manifest before any test runs: the identity must name
a file and a non-empty exact name, both files must exist, the mutation anchor must occur **exactly
once** in its file (a two-place anchor silently mutates whichever comes first), the replacement must
differ from the anchor, and `vitest list` must collect the name exactly once. Table-driven names are
built at run time, so the collector reports the literal template; those are listed as `deferred` and
the baseline gate enforces uniqueness for real.

### The outcomes, and why only one of them is evidence

| Outcome                   | Meaning                                                                        | Evidence?                                      |
| ------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `KILLED_ASSERTION`        | all eight conditions above hold                                                | **yes — the only one**                         |
| `SURVIVED`                | the intended test ran and passed under the mutation                            | no                                             |
| `BASELINE_FAILED`         | the intended test did not pass cleanly on the pristine tree                    | no                                             |
| `NO_TEST_MATCH`           | tests were collected, none carries the identity — a manifest error             | no                                             |
| `AMBIGUOUS_TEST_IDENTITY` | more than one test carries it, so which failed cannot be established           | no                                             |
| `UNRELATED_FAILURE`       | the intended test asserted, but something else failed too                      | no: the kill is not attributable               |
| `HOOK_FAILURE`            | a `beforeAll`/`afterEach` threw around the tests                               | no                                             |
| `INFRA_FAILURE`           | unreachable database, revoked grant, global setup, or no tests collected       | no                                             |
| `TIMEOUT`                 | the whole run exceeded its deadline and was killed                             | no                                             |
| `KILLED_BY_TIMEOUT`       | the mutation made the code hang, so the intended test failed without asserting | no: a real detection, weaker than an assertion |
| `BUILD_OR_LOAD_FAILURE`   | a module would not transform or load on the pristine tree                      | no                                             |
| `INVALID_MUTANT`          | the mutated source would not transform or load, so the edit is untestable      | no                                             |
| `REPORTER_FAILURE`        | no report, a malformed one, or one from another report version                 | no                                             |

The classifier consumes only the reporter's `failureCategory` and the canonical identity. It never
reads an error's name, message or fields, because every generation that did was spoofable.

`UNRELATED_FAILURE` is the newest of these and it matters: a run where the intended test asserted
_and_ something unrelated blew up is not clean evidence, because the unrelated failure may be the
reason the intended test failed. The previous version returned `KILLED_ASSERTION` with
`unrelatedFailures > 0` recorded in the same object.

A variant may also carry a `note`, for the case where `KILLED_ASSERTION` is impossible _and_
correct: two variants here are rejected by an assertion inside a migration during global setup, so
no suite runs and no test can claim the kill. That is a stronger control than a test, and the report
says so rather than inflating the count.

### The harness's own variants

The `H*` variants attack the harness rather than the audit subsystem: each removes one conjunct of
the trust rules above and names the adversarial test that must catch it. They are what makes the
rest of the report mean anything, so they are part of the same corpus.

The sweep passes the mutated reporter to the mutated run, which is deliberate: every `H*` reporter
variant is a **relaxation**, so a genuine assertion still types as `ASSERTION` and the kill stays
observable. A hypothetical tightening of the reporter would fail closed into a non-evidence outcome
rather than report a false kill.

### Reading a SURVIVED verdict

A survivor is **not** a code defect. It means the named test does not distinguish the defect — the
test is weaker than it looks. Every survivor in this repository's history has been exactly that, and
two were instructive enough to be worth recording:

- an INV-12 assertion that only ever ran over a _sound_ sweep, so it never reached the failure path
  where a driver message would leak;
- a vacuous-pass guard in a check's `main()` that no test reached, because nothing ran it as a
  process.

A survivor is also the expected result for a variant that removes a **redundant** guard: if two
independent checks enforce one property, removing either leaves the outcome unchanged. That is a
signal to write a test that isolates the term, not to delete the variant — four variants were
retargeted that way rather than dropped.

### Adding a variant

Add an entry to the manifest, then run `--validate` before anything else. It changes nothing and
runs no tests, and it is the cheapest place to catch a refactor that silently orphaned a control
(`anchor not found`), an anchor that now resolves to two places, and an identity that names no test
or two tests.
