# Verification artifacts

## The audit mutation sweep

- **Manifest:** [`audit-mutation-manifest.json`](audit-mutation-manifest.json) — the defective
  variants, as data.
- **Latest report:** [`audit-mutation-report.md`](audit-mutation-report.md) — one row per variant
  with its verdict.
- **Runner:** [`../../scripts/mutation-sweep.ts`](../../scripts/mutation-sweep.ts)
- **Classifier:** [`../../scripts/mutation-outcome.ts`](../../scripts/mutation-outcome.ts)
- **Reporter:** [`../../scripts/mutation-reporter.ts`](../../scripts/mutation-reporter.ts)
- **Probe:** [`../../scripts/mutation-evidence-probe.ts`](../../scripts/mutation-evidence-probe.ts)
- **Wrapper, state and contract:** [`../../packages/testing/src/mutation/`](../../packages/testing/src/mutation/),
  re-exported from `@moin/testing`
- **Invariants:** INV-01, INV-10, INV-12 · **Review:** QG-09

A test that has never been made to fail is a hope, not a control. Every guard in the audit
subsystem therefore has at least one **defective variant**: a named, minimal edit that would
reintroduce the defect the guard exists to prevent. The sweep applies each one to the working tree,
runs only the test that must catch it, classifies the run structurally, and restores the file
byte-for-byte from memory.

```
node scripts/mutation-sweep.ts --validate     # identities and anchors resolve; runs no tests
node scripts/mutation-sweep.ts                # the full sweep
node scripts/mutation-sweep.ts --only H10-state-skips-the-terminal-identity-check
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
6. that test executed, and failed;
7. the run did not time out, and the test did not fail by timing out;
8. no module failed to build or load;
9. the test is registered through the trusted `evidenceTest` wrapper;
10. the value that **terminated the test body** is, by `===`, an object a Vitest matcher threw;
11. that object was recorded in **this** invocation, under **this** test identity;
12. exactly one matcher failure occurred in the invocation, with nothing rejected or suspect;
13. **no other test failed** anywhere in the run.

Anything that cannot be established falls into a named non-evidence outcome.

### Why no property of the thrown value is part of the proof

Five generations of this decision read the thrown value. Each was measured, and each was defeated:

| Generation | Authority                                                                                    | How it fell                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1          | exit code                                                                                    | an unreachable database reported every variant killed                                                                |
| 2          | message text                                                                                 | `database connection refused while executing toThrow assertion` counted                                              |
| 3          | `name` + `expected`/`actual`/`showDiff`/`ok`                                                 | an `Error` decorated with those four fields counted                                                                  |
| 4          | the above, plus the `constructor`/`toString` keys Vitest's serializer adds to foreign errors | a **plain object literal** of that shape has neither key, and counted; so did an `Error` whose `toJSON()` returns it |
| 5          | an enumerable, invocation-scoped token the matcher wrapper stamped on the error              | `Object.assign(new Error('ordinary'), caught)` copies the token, and counted                                         |

Generation 5 is the instructive one, because it looked like provenance. It was a **transferable
credential**: whatever a test can read off one object it can write onto another. Making it a symbol,
non-enumerable, random, hashed or signed changes nothing about that — it only raises the price of
copying. So there is no token, no mark of any kind is written onto a thrown value, and nothing in
the verdict reads a field of one.

**Object identity is the one property of a value that cannot be transferred.**
`Object.assign(terminal, caught)` yields `terminal !== caught`, and that is the whole mechanism.

### The architecture

Four modules, each with one job:

| Module                                                                   | Job                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [`mutation-probe-contract.ts`](../../scripts/mutation-probe-contract.ts) | the shape the probe emits and the reporter reads; no side effects                          |
| [`mutation-evidence-state.ts`](../../scripts/mutation-evidence-state.ts) | the module-private `WeakMap` and every decision about it; no side effects                  |
| [`mutation-evidence-probe.ts`](../../scripts/mutation-evidence-probe.ts) | the `setupFiles` entry: patches the matcher prototype, opens and closes invocation windows |
| [`mutation-evidence-test.ts`](../../scripts/mutation-evidence-test.ts)   | `evidenceTest`, the trusted wrapper that catches the terminal value                        |

**The matcher boundary.** Every function on Vitest's `Assertion.prototype` — 185 own properties, the
matchers among them writable and configurable — is replaced by a wrapper that, when the matcher
throws, hands the thrown object to the recorder. The recorder puts it in the private `WeakMap`
against `{ invocationId, file, fullName, matcher, seq }` and **does not touch the object**. The
`rejects` and `resolves` getters are wrapped too, because Vitest raises "promise resolved instead of
rejecting" from inside its own async chain without running a matcher, and that is still its
assertion machinery failing. `not` needs no wrapper: it returns an assertion with the same
prototype.

The recorder is handed out by `installMatcherRecorder()`, which may be called **once** — the probe
is the caller, and a second caller gets an exception. A test therefore cannot obtain a recorder and
register an object of its own. That is a guard against the easy attack; the load-bearing property is
that confirmation needs the actual object a matcher threw.

**The terminal value.** A test registered with `evidenceTest` has its body run inside:

```ts
try {
  await body(context);
} catch (terminal) {
  confirmTerminal(terminal);
  throw terminal;
}
```

`confirmTerminal` asks the private map about that exact object, and nothing else. The error is
rethrown unchanged, so a wrapped test fails, reports and reads exactly as it would have.

**Why a wrapper, rather than a hook.** Measured on Vitest 5.0.2: by the time any hook runs the live
object is gone. In `afterEach` and in `onTestFailed`, `task.result.errors[0]` is already a serialized
plain object — `instanceof Error` is false and the constructor is undefined — so no hook can compare
it by identity. `task.fn` is not exposed on the task at hook time, and Vitest 5 exports no base
runner class to extend. Inside the test callback is the only place the terminal value still exists.

**Eligibility follows from that.** A test registered with plain `it` runs exactly as before and
fails exactly as before; it is simply not eligible for mutation evidence, and a manifest entry
pointing at one is reported `NOT_EVIDENCE_ELIGIBLE` rather than quietly counted or hidden among
infrastructure failures.

Every killing test in the manifest is therefore registered with `evidenceTest`, with two deliberate
exceptions (`N8`, `P8`) whose defects are caught by a guard inside a migration rather than by an
assertion — see below. Migration is registration only: the name, the body, the assertions, the
setup, the database work and the timeout are untouched, so the manifest's `{ file, fullName }`
identity still resolves and the suites' test counts are unchanged.

| Guarantee                            | How                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| produced inside the test process     | a setup file, in the worker                                                                                                                            |
| tied to canonical identity           | read from `context.task`, never from `expect.getState()` — measured: under `it.concurrent` the module-level state reports _another_ test's name        |
| tied to this invocation              | a fresh id per `beforeEach`, including per retry                                                                                                       |
| cannot be made by throwing           | the record has one writer, and it is a matcher wrapper                                                                                                 |
| cannot be transferred                | the check is `===` against a `WeakMap`; nothing is written on the value                                                                                |
| reset per test                       | the window's first sequence number excludes everything earlier                                                                                         |
| stale records rejected               | a record from another invocation is refused by name, and anything outside the window is counted in `rejected`, which makes the invocation non-evidence |
| hook failures cannot fabricate it    | a failing `afterEach` stops the probe completing, so no record is attached; a hook error also outranks every test verdict in the classifier            |
| parameterized cases stay distinct    | each generated case is its own invocation, and a sibling's object is refused                                                                           |
| concurrency cannot cross-contaminate | overlapping windows are **detected** and both marked `suspect`; the probe declines to attribute rather than guessing                                   |

The probe is also the **last** writer of its key. A test can reach `task.meta` and write a complete,
self-consistent record naming itself — the fixtures do exactly that — and the probe's `afterEach`
overwrites it, because a setup file's hooks run after the body.

`expect.getState().assertionCalls` survives as a **diagnostic**. A successful matcher followed by any
throw reports a non-zero count and zero failures, which is precisely why a counter could never be
the signal.

### How the killing test is identified

A variant names its killing test as a canonical pair:

```json
"killingTest": {
  "file": "scripts/check-audit-arguments.integration.test.ts",
  "fullName": "the scanner > refuses a scan that inspected nothing"
}
```

Both are compared exactly. There is no `includes`, no prefix match, no name-only match. Zero matches
is `NO_TEST_MATCH`, more than one is `AMBIGUOUS_TEST_IDENTITY`, and the baseline and mutant runs must
resolve the same single identity. A parameterized test must be named by one concrete generated case.
The baseline cache key is `[git HEAD, project, file, fullName]`, so no baseline can vouch for another
tree or another test.

### Applying a variant

`applyMutation` is the one place a variant is injected, used by both the sweep and `--validate`, so
validation can be neither more permissive than execution nor less. It refuses an anchor that occurs
zero times, an anchor that occurs more than once, an empty anchor, and a replacement identical to its
anchor. Each refusal is `INVALID_MUTANT`, and nothing is written.

Uniqueness is enforced **at application time** and not only in `--validate`, because an operator who
skips validation must not get a weaker guarantee. The splice is positional rather than
`String.prototype.replace`, which interprets its replacement: `$$` means a literal `$`, so every
variant whose replacement contained a SQL function body was once silently corrupted into `AS $` and
the migration failed with a syntax error. The variant looked detected; nothing had been tested.

### The outcomes, and why only one of them is evidence

| Outcome                   | Meaning                                                                        | Evidence?                                      |
| ------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `KILLED_ASSERTION`        | all thirteen conditions above hold                                             | **yes — the only one**                         |
| `SURVIVED`                | the intended test ran and passed under the mutation                            | no                                             |
| `BASELINE_FAILED`         | the intended test did not pass cleanly on the pristine tree                    | no                                             |
| `NO_TEST_MATCH`           | tests were collected, none carries the identity — a manifest error             | no                                             |
| `AMBIGUOUS_TEST_IDENTITY` | more than one test carries it, so which failed cannot be established           | no                                             |
| `NOT_EVIDENCE_ELIGIBLE`   | the test detected the mutation but is not registered through `evidenceTest`    | no: a gap in the corpus's reach, not a defect  |
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

Whether a copy really is a different object as Vitest reports it, whether the matcher wrapper really
intercepts every assertion style, and whether a planted record really is overwritten are facts about
Vitest and this harness together. A fixture built by hand only proves the fixture agrees with the
assumption that produced it, which is where generations 3, 4 and 5 were defeated. So
[`mutation-reporter.realvitest.test.ts`](../../scripts/mutation-reporter.realvitest.test.ts) spawns a
child Vitest with **the production probe, the production wrapper, the production reporter and the
production `categoriseTest`** over real failing fixtures in
[`scripts/__fixtures__/reporter/`](../../scripts/__fixtures__/reporter/), and asserts the output.

Measured, and asserted:

| Fixture                                                                                                                   | Verdict                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| catch a matcher failure, `Object.assign` it onto an ordinary `Error`, throw that                                          | `ERROR` — a copy is a different object                                     |
| every own property **and symbol** copied onto another `Error`                                                             | `ERROR`                                                                    |
| a clone with the same prototype, name, message and stack                                                                  | `ERROR`                                                                    |
| catch, `await`, then throw a copy                                                                                         | `ERROR`                                                                    |
| the same matcher object rethrown immediately                                                                              | `ASSERTION`                                                                |
| the same matcher object thrown later in the same invocation                                                               | `ASSERTION` — the intended semantics while exactly one matcher failed      |
| a swallowed matcher failure, then an ordinary error                                                                       | `ERROR`                                                                    |
| a matcher object from **another test**                                                                                    | `ERROR` — rejected by invocation id                                        |
| a matcher object from the **previous retry** of the same test                                                             | `ERROR` — a retry is a new invocation                                      |
| a matcher object from **another parameterized case**                                                                      | `ERROR`, while the case that earned it is `ASSERTION`                      |
| two matcher failures in one invocation                                                                                    | `ERROR` — fails closed                                                     |
| concurrent tests failing matchers                                                                                         | `UNKNOWN` — overlap detected                                               |
| plain thrown assertion-shaped object · `toJSON` spoof · successful `expect` then a throw · Node's `assert.AssertionError` | `ERROR`, all four, with zero matcher failures                              |
| a forged probe record planted in `task.meta`, complete and consistent                                                     | `ERROR` — overwritten                                                      |
| an unwrapped test with a genuine matcher failure                                                                          | `NOT_ELIGIBLE`                                                             |
| genuine failures through `not`, `rejects`, `resolves`, and `rejects` on a resolving promise                               | `ASSERTION`                                                                |
| a timeout · a `beforeAll` failure · an `afterEach` failure · the same name in two modules                                 | `TIMEOUT` · hook error, not executed · `UNKNOWN` · distinguished by `file` |

A Vitest upgrade that moves the matcher boundary fails loudly there instead of quietly turning the
corpus into non-evidence.

### The harness's own variants

The `H*` variants attack the harness rather than the audit subsystem: each removes one conjunct of
the rules above and names the adversarial test that must catch it.

Three limits are worth stating rather than hiding.

- The sweep passes the **mutated reporter** to the mutated run. That is sound because every `H*`
  reporter variant is a _relaxation_, so a genuine matcher failure still types `ASSERTION` and the
  kill stays observable; a tightening would fail closed into a non-evidence outcome rather than
  report a false kill.
- A mutation that stops **any** test producing `ASSERTION` cannot be killed by an assertion, because
  the harness could not then report its own kill. Two candidate variants were exactly that — removing
  `confirmTerminal` from the wrapper, and removing `beginEvidence` — and both were **removed from the
  manifest** rather than kept as permanent non-evidence rows. The real-Vitest suite asserts those two
  invariants directly instead.
- A test registered with plain `it` cannot bear evidence, so a manifest entry naming one is reported
  `NOT_EVIDENCE_ELIGIBLE`. That is a gap in reach, not a defect, and the report says which entries
  are in it and why. Two entries are there permanently and correctly: `N8-backfill-removed` and
  `P8-sequence-backfill-removed` are detected by a guard inside the migration — `0010` refusing an
  incomplete register backfill, `0011` failing `NOT NULL` — so the test fails on a thrown database
  error and no matcher ever throws. Wrapping those tests would not change that, and rewriting them
  to catch the error and `expect()` it would be manufacturing evidence rather than finding it.

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
