# Verification artifacts

## The audit mutation sweep

- **Manifest:** [`audit-mutation-manifest.json`](audit-mutation-manifest.json) — the defective
  variants, as data.
- **Latest report:** [`audit-mutation-report.md`](audit-mutation-report.md) — one row per variant
  with its verdict.
- **Runner:** [`../../scripts/mutation-sweep.ts`](../../scripts/mutation-sweep.ts)
- **Classifier:** [`../../scripts/mutation-outcome.ts`](../../scripts/mutation-outcome.ts)
- **Reporter:** [`../../scripts/mutation-reporter.ts`](../../scripts/mutation-reporter.ts)
- **Probe:** [`../../scripts/mutation-evidence-probe.ts`](../../scripts/mutation-evidence-probe.ts) ·
  **contract:** [`../../scripts/mutation-probe-contract.ts`](../../scripts/mutation-probe-contract.ts)
- **Invariants:** INV-01, INV-10, INV-12 · **Review:** QG-09

A test that has never been made to fail is a hope, not a control. Every guard in the audit
subsystem therefore has at least one **defective variant**: a named, minimal edit that would
reintroduce the defect the guard exists to prevent. The sweep applies each one to the working tree,
runs only the test that must catch it, classifies the run structurally, and restores the file
byte-for-byte from memory.

```
node scripts/mutation-sweep.ts --validate     # identities and anchors resolve; runs no tests
node scripts/mutation-sweep.ts                # the full sweep
node scripts/mutation-sweep.ts --only H1-reporter-trusts-serialized-assertion-shape
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

The harness is itself a control, and it has been wrong five times, always generously. The verdict is
defined so that it can only mean **all** of the following:

1. the baseline run of the intended test, on the pristine tree, ran and passed and nothing else in
   that run failed;
2. the mutant run produced a report this classifier's version understands;
3. nothing failed outside a test — no unhandled error, no module error;
4. no hook failed around the tests;
5. **exactly one** test in the run carries the manifest's canonical identity
   `killingTest: { file, fullName }`, both compared with `===`;
6. that test executed;
7. that test failed;
8. the run did not time out, and the test did not fail by timing out;
9. no module failed to build or load;
10. the reporter typed the failure `ASSERTION`, which requires:
11. a trusted in-process **matcher-failure event** for this invocation, with nothing rejected and
    no `suspect` entry,
12. that event bound to this exact test identity, carrying exactly one matcher failure, and the
    value that propagated carrying that failure's token;
13. **no other test failed** anywhere in the run.

Anything that cannot be established falls into a named non-evidence outcome.

### Why the thrown value is not part of the proof

Four generations of this harness tried to recognise an assertion _from the error_. Each was
measured, and each was spoofed:

| Generation | Authority                                                                             | How it fell                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | exit code                                                                             | an unreachable database reported every variant killed                                                                                 |
| 2          | message text                                                                          | `database connection refused while executing toThrow assertion` counted                                                               |
| 3          | `name` + `expected`/`actual`/`showDiff`/`ok`                                          | an ordinary `Error` decorated with those four fields counted                                                                          |
| 4          | the above, plus "Vitest's serializer adds `constructor`/`toString` to foreign errors" | a **plain object literal** of that shape is serialized with neither marker and counted; so did an `Error` whose `toJSON()` returns it |

The lesson is not that each list of fields was too short. A thrown value is **data authored by the
code under test**, so no property of it can ever be authority for what the test framework did. There
is no tighter heuristic that fixes this, and none is used any more. The `name` and `message` survive
in the report as diagnostics, and `assertionCalls` with them; nothing reads them to classify.

### Assertion provenance

[`mutation-evidence-probe.ts`](../../scripts/mutation-evidence-probe.ts) is loaded as a `setupFiles`
entry by **both** Vitest projects, so the sweep measures tests exactly as CI runs them. It does two
things.

**It wraps the matcher boundary.** Every function on Vitest's `Assertion.prototype` — 185 own
properties, the matchers among them writable and configurable — is replaced by a wrapper that
appends a `MATCHER_FAILURE` record when that matcher throws. The `rejects` and `resolves` getters
are wrapped too, because Vitest raises "promise resolved instead of rejecting" from inside its own
async chain without running a matcher, and that is still its assertion machinery failing rather than
the code under test throwing. `not` needs no wrapper: it returns an assertion with the same
prototype.

That wrapper is the **only** code that can create a record. `throw` does not call a matcher, so no
throw of any shape creates one. This is the whole of the security property, and it is architectural:
reaching the record requires going through the machinery, not resembling its output.

**It bounds each invocation.** `beforeEach` opens a window with a fresh id and the canonical
identity read from Vitest's own task; `afterEach` closes it and emits only the records made inside
it, for that identity. One matcher failure counts once however many wrappers the thrown value passes
through on its way out, because records are deduplicated by the object's identity.

| Guarantee                            | How                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| produced inside the test process     | a setup file, in the worker                                                                                                                       |
| tied to canonical identity           | read from `context.task`, never from `expect.getState()` — measured: under `it.concurrent` the module-level state reports _another_ test's name   |
| tied to this invocation              | a fresh id per `beforeEach`, including per retry                                                                                                  |
| cannot be made by throwing           | the record has one writer, and it is a matcher wrapper                                                                                            |
| reset per test                       | the window's first sequence number excludes everything earlier                                                                                    |
| stale records rejected               | counted in `rejected`, which makes the invocation non-evidence                                                                                    |
| hook failures cannot fabricate it    | a failing `afterEach` stops the probe completing, so no record is attached at all; and a hook error outranks every test verdict in the classifier |
| parameterized cases stay distinct    | identity is the full generated name                                                                                                               |
| concurrency cannot cross-contaminate | overlapping windows are **detected** and both marked `suspect`; the probe declines to attribute rather than guessing                              |

The probe is also the **last** writer of its key. A test can reach `task.meta` and write a complete,
self-consistent record naming itself — the fixtures do exactly that, token and all — and the probe's
`afterEach` overwrites it, because a setup file's hooks run after the body.

**One narrow use of the error object.** The wrapper stamps an enumerable token on the value it is
about to rethrow, and the reporter requires the failing test to carry one of the invocation's
tokens. This answers one question — did the failure the invocation _earned_ actually propagate, or
did the test catch it and fail some other way — and it can only ever **remove** evidence: without
the event nothing reads the token, so no token can create a verdict. The token is scoped to one
invocation, which is how a replayed one is spotted. It is a correlation mechanism, not a secret, and
is not described as cryptographic.

### How the killing test is identified

A variant names its killing test as a canonical pair:

```json
"killingTest": {
  "file": "packages/db/src/audit-verification.integration.test.ts",
  "fullName": "the sweep > refuses to report a partial run as sound"
}
```

Both are compared exactly. There is no `includes`, no prefix match, no name-only match. Zero matches
is `NO_TEST_MATCH`, more than one is `AMBIGUOUS_TEST_IDENTITY`, and the baseline and mutant runs must
resolve the same single identity. A parameterized test must be named by one concrete generated case.
The baseline cache key is `[git HEAD, project, file, fullName]`, so no baseline can vouch for another
tree or another test.

### Applying a variant

`applyMutation` in [`mutation-sweep.ts`](../../scripts/mutation-sweep.ts) is the one place a variant
is injected, used by both the sweep and `--validate`, so validation can be neither more permissive
than execution nor less. It refuses an anchor that occurs zero times, an anchor that occurs more than
once, an empty anchor, and a replacement identical to its anchor. Each refusal is `INVALID_MUTANT`.

Uniqueness is enforced **at application time** and not only in `--validate`, because an operator who
skips validation must not get a weaker guarantee. The splice is positional rather than
`String.prototype.replace`, which interprets its replacement: `$$` means a literal `$`, so every
variant whose replacement contained a SQL function body was once silently corrupted into `AS $` and
the migration failed with a syntax error. The variant looked detected; nothing had been tested.

`--validate` additionally checks the manifest before any test runs: duplicate ids, a missing or
malformed identity, files that do not exist, and names `vitest list` does not collect exactly once.
Table-driven names are built at run time, so the collector reports the literal template; those are
listed as `deferred` and the baseline gate enforces uniqueness for real.

### The outcomes, and why only one of them is evidence

| Outcome                   | Meaning                                                                        | Evidence?                                      |
| ------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `KILLED_ASSERTION`        | all thirteen conditions above hold                                             | **yes — the only one**                         |
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
| `INVALID_MUTANT`          | the variant could not be applied, or the mutated source would not load         | no                                             |
| `REPORTER_FAILURE`        | no report, a malformed one, or one from another report version                 | no                                             |

The classifier consumes only the reporter's `failureCategory` and the canonical identity. It never
reads an error's name, message or fields.

### Pinned against real Vitest

Matcher wrapping and the serializer's behaviour are facts about Vitest, not about our types, and a
fixture built by hand only proves the fixture agrees with the assumption that produced it — which is
precisely where generations 3 and 4 were defeated. So
[`mutation-reporter.realvitest.test.ts`](../../scripts/mutation-reporter.realvitest.test.ts) spawns a
child Vitest with **the production probe, the production reporter and the production
`categoriseTest`** over real failing fixtures in [`scripts/__fixtures__/reporter/`](../../scripts/__fixtures__/reporter/),
and asserts the machine-readable output. Nothing is reimplemented there.

Measured, and asserted:

| Fixture                                                                                     | Verdict                                   |
| ------------------------------------------------------------------------------------------- | ----------------------------------------- |
| plain thrown `{ name: 'AssertionError', expected, actual, showDiff, ok }`                   | `ERROR`                                   |
| `Error` whose `toJSON()` returns that shape                                                 | `ERROR`                                   |
| `Error` decorated with those fields                                                         | `ERROR`                                   |
| a successful `expect`, then that plain throw (`expectCalls: 2`)                             | `ERROR`                                   |
| successful expects, then the `toJSON` error                                                 | `ERROR`                                   |
| Node's own `assert.AssertionError`                                                          | `ERROR`                                   |
| a genuine matcher failure                                                                   | `ASSERTION`                               |
| genuine failures through `not`, `rejects`, `resolves`, and `rejects` on a resolving promise | `ASSERTION`                               |
| a matcher failure the test swallowed before throwing                                        | `ERROR`                                   |
| two matcher failures in one test                                                            | `UNKNOWN`                                 |
| a forged probe record, complete and token-stamped                                           | `ERROR` — overwritten                     |
| a forged record naming another test                                                         | `ERROR` — overwritten                     |
| concurrent tests failing matchers                                                           | `UNKNOWN` — refused                       |
| an `afterEach` failure beside an assertion                                                  | `UNKNOWN` — no record attached            |
| a timeout                                                                                   | `TIMEOUT`                                 |
| a `beforeAll` failure                                                                       | suite hook error, the test never executed |
| the same full name in two modules                                                           | distinguished by `file`                   |

A Vitest upgrade that moves the matcher boundary fails loudly there instead of quietly turning the
corpus into non-evidence.

### The harness's own variants

The `H*` variants attack the harness rather than the audit subsystem: each removes one conjunct of
the rules above and names the adversarial test that must catch it. They are what makes the rest of
the report mean anything, so they are part of the same corpus.

Two limits are worth stating rather than hiding. First, the sweep passes the mutated reporter to the
mutated run; that is sound because every `H*` reporter variant is a **relaxation**, so a genuine
matcher failure still types `ASSERTION` and the kill stays observable, while a tightening would fail
closed into a non-evidence outcome rather than report a false kill. Second, a probe mutation broad
enough to stop _any_ test producing `ASSERTION` cannot be killed by an assertion — the harness would
be unable to report its own kill. Those properties are proven by the real-Vitest suite instead, and
the probe variants in the manifest are deliberately narrow enough that the parent run's own record
stays valid.

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
