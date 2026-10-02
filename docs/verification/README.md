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
- **Wrapper, state and contract:** [`../../packages/testing/src/mutation/`](../../packages/testing/src/mutation/);
  `@moin/testing` exports the registration API (`evidenceTest`, `concurrentEvidenceTest`) and the
  inert contract constants, and nothing that writes provenance
- **Invariants:** INV-01, INV-10, INV-12 · **Review:** QG-09

A test that has never been made to fail is a hope, not a control. Every guard in the audit
subsystem therefore has at least one **defective variant**: a named, minimal edit that would
reintroduce the defect the guard exists to prevent. The sweep applies each one to the working tree,
runs only the test that must catch it, classifies the run structurally, and restores the file to
the bytes it proved were HEAD's — see [the pristine-source contract](#the-pristine-source-contract).

```
node scripts/mutation-sweep.ts --validate     # identities and anchors resolve; runs no tests
node scripts/mutation-sweep.ts                # the full sweep
node scripts/mutation-sweep.ts --only H10-state-skips-the-terminal-identity-check
node scripts/mutation-sweep.ts --report docs/verification/audit-mutation-report.md
node scripts/mutation-sweep.ts --json results.json        # machine-readable, for a diff
```

Exit codes: `0` every variant is evidence, `1` some variant is not, `2` a usage or manifest error,
`3` the source tree could not be shown to be the HEAD tree, so nothing was measured, `4` another
sweep holds this worktree's lock, so nothing was read or measured. Both the sweep
and `--validate` start with the same pristine check, so **commit before you sweep**: a target with
uncommitted changes is indistinguishable from a mutant a killed sweep left behind, and is refused.

The report is generated, so format it before committing — the `format` gate checks it like any
other file:

```
pnpm exec prettier --write docs/verification/audit-mutation-report.md
```

It needs the local stack (`pnpm dev:up`) and the environment file, like any integration run —
`node --env-file-if-exists=.env scripts/mutation-sweep.ts …`, or `--env-file=.env.example` against
the stack's documented local defaults. The harness's own variants (`H*`) run in the `unit` project and
need neither. Started without the file, every integration variant comes back `BASELINE_FAILED` ("the
run collected no tests at all"): the harness refuses to count a kill on a tree whose baseline never
ran, which is the point.

## The identity mutation sweep (P06.05.04)

- **Manifest:** [`identity-mutation-manifest.json`](identity-mutation-manifest.json): the
  identity-claims contract, the per-environment OIDC provider switch, the client-secret boundary
  and the local realm's claim scopes.
- **Latest report:** [`identity-mutation-report.md`](identity-mutation-report.md)

The same runner and the same verdict rules as the audit sweep. Every variant but one runs in the
`unit` project; `I5-…` kills against a token the local Keycloak really issues, so it needs the
local stack and `TEST_OIDC_ISSUER_URL`:

```
node --env-file=.env.example scripts/mutation-sweep.ts \
  --manifest docs/verification/identity-mutation-manifest.json \
  --report docs/verification/identity-mutation-report.md
```

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

| Module                                                                       | Job                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`probe-contract.ts`](../../packages/testing/src/mutation/probe-contract.ts) | the shape the probe emits and the reporter reads; inert constants and types                                                                                         |
| [`evidence-state.ts`](../../packages/testing/src/mutation/evidence-state.ts) | the module-private `WeakMap`, every decision about it, and the trusted wrapper — `beginEvidence`, `confirmTerminal` and `intercept` are exported from **no** module |
| [`evidence-test.ts`](../../packages/testing/src/mutation/evidence-test.ts)   | the public face: re-exports `evidenceTest` and `concurrentEvidenceTest`, registration only                                                                          |
| [`mutation-evidence-probe.ts`](../../scripts/mutation-evidence-probe.ts)     | the `setupFiles` entry: patches the matcher prototype, opens and closes invocation windows                                                                          |

**The matcher boundary.** Every function on Vitest's `Assertion.prototype` — 185 own properties, the
matchers among them writable and configurable — is replaced by a wrapper that, when the matcher
throws, hands the thrown object to the recorder. The recorder puts it in the private `WeakMap`
against `{ invocationId, file, fullName, matcher, seq }` and **does not touch the object**. The
`rejects` and `resolves` getters are wrapped too, because Vitest raises "promise resolved instead of
rejecting" from inside its own async chain without running a matcher, and that is still its
assertion machinery failing. `not` needs no wrapper: it returns an assertion with the same
prototype.

The recorder and the invocation window are handed out together by `installProbe()`, which may be
called **once** — the probe is a setup file and takes them before any test module loads, by relative
import, and a second caller gets an exception. A test therefore cannot obtain a recorder and register
an object of its own. Even with them, nothing can mark an invocation eligible or confirm a terminal
value: those two capabilities never leave the state module.

### Who can reach the capabilities

`beginEvidence` opens eligibility and `confirmTerminal` vouches for a terminal value. A test that can
call both can make itself evidence without being registered for it: catch a genuine matcher object
`M`, open, confirm `M`, then fail with an unrelated error. An independent review did exactly that
from a plain `it` test, through the package root, while it re-exported them — the reporter typed the
failure `ASSERTION` and the classifier `KILLED_ASSERTION`.

Removing the re-exports would not have been enough. An `exports` map governs the package name only,
and any `export` in the repository is reachable by a relative import. So the line is drawn at the
source:

- `beginEvidence`, `confirmTerminal` and the `intercept` wrapper that calls them are module-scoped in
  `evidence-state.ts` and **exported from no module**. The only path to them is `evidenceTest`, which
  is a _registration_ call: Vitest refuses to register a test from inside a running one, so a test
  body cannot use it to wrap itself (the fixture tries, and is refused).
- `installProbe` is exported, because the probe lives in `scripts/` — and is one-shot and already
  taken by the time any test runs.
- `@moin/testing`'s `exports` map is exactly `{ ".": "./src/index.ts" }`, and the root exports an
  allow-list: the factories, fault injection, the clock, `evidenceTest`, `concurrentEvidenceTest` and
  the inert contract constants.

[`testing-export-surface.test.ts`](../../scripts/testing-export-surface.test.ts) pins all of it:
the `exports` map, every subpath a consumer might try, the root allow-list, the state module's
export list, the one-shot handover, and every occurrence of a capability name in the repository.

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
tree or another test — and it is consulted only after the pristine checks below have passed.

### The pristine-source contract

Exactly one mutant, against the HEAD tree. The sweep mutates in place and restores in a `finally`,
and `SIGKILL`, a crash or a lost machine skip the `finally`. It used to read each target from the
working tree as its "original", so after a killed sweep the next one took the leftover mutant M1 as
pristine, and a second mutant M2 whose anchor still resolved was baselined and measured on top of
it. An independent review reproduced that.

The working tree is now never trusted:

1. **Before anything runs** — baseline, cache lookup or mutation — HEAD is resolved, and **every**
   target named anywhere in the manifest, not only the selected variants', is hashed the way Git
   would store it (`git hash-object --path=<file> --stdin`, so the path's `eol` and clean filters
   apply) and compared with its blob in `git ls-tree HEAD`. A target must be a tracked regular file
   with a plain repository-relative path. Any difference aborts the whole sweep with exit `3`. It is
   **not repaired**: whether the difference is a stale mutant or someone's work is not the sweep's to
   guess.
2. **Per variant**, the bytes that will be restored are the bytes that were hashed — read once, so
   the proof is over exactly what is put back. After the mutant run the file is restored, re-read,
   and must equal those bytes and hash to the HEAD blob; then every target is checked again and HEAD
   must not have moved. Any failure aborts before the next variant.
3. `SIGINT` and `SIGTERM` stop the test run, restore and verify the active target, and exit `130` or
   `143`. **`SIGKILL` cannot be handled by anything**; what protects against it is rule 1 on the next
   invocation.

### One sweep per worktree

Exactly one mutant also means exactly one **sweep**. Two sweeps in one worktree both passed the
pristine check and then took turns writing one file. An independent review reproduced it, and so did
this repository before the fix, with M1 and M5 in the same file sharing a killing test: A's mutant
run observed M5's bytes, B's baseline observed A's M1, B's mutant run observed the pristine file,
both reported `KILLED_ASSERTION`, and the file ended pristine. Every per-variant check passed,
because each sweep restored what it had written.

So a sweep takes an exclusive lock first:

- **Primitive.** `mkdir` without `recursive`: it creates the directory or fails with `EEXIST`,
  atomically. Nothing is checked before it, so two sweeps cannot both succeed.
- **Where.** `$(git rev-parse --absolute-git-dir)/moin-mutation-sweep.lock` — the worktree's **own**
  Git directory: `.git/` for the main worktree, `.git/worktrees/<name>/` for a linked one. Linked
  worktrees therefore sweep in parallel; two sweeps in one worktree cannot. The lock is never a
  source file.
- **When.** Taken before HEAD is read, before the pristine check, the baseline cache or any
  baseline. Held through every baseline, mutant, restore and verification, and through writing the
  report. Released in one `finally`. `--only` takes the same worktree-wide lock: a partial sweep's
  tests can still observe any file.
- **Owner record.** `owner.json` inside the directory — pid, hostname, cwd, HEAD, start time and a
  random token — is written after ownership is taken. It is diagnostics: a refusal prints it. If
  it cannot be written the sweep releases the lock and aborts. Release removes only a lock whose
  record still carries this process's token, and is idempotent.
- **Signals.** `SIGINT` and `SIGTERM` restore and verify the active target, then release, then exit
  `130`/`143`. A restore that cannot be verified — on a signal or otherwise — **keeps** the lock,
  with the reason in its record, so the next sweep refuses until a human has looked.
- **`--validate`** writes nothing and runs no test, so it takes no lock. It does refuse with exit
  `4` while a lock exists, because the targets then hold another sweep's mutant. No sweep relies on
  a validation result: it repeats every check under its own lock.

**A lock is never removed automatically**, however old it looks. `SIGKILL`, a crash or a lost
machine can leave one behind, with a mutant still on disk. The next sweep refuses with exit `4`, and
the message names the holder. To recover:

1. confirm no sweep is running — `ps -p <pid>` on the host the message names;
2. compare every mutation target with HEAD and restore any that differ (`git diff HEAD --stat`);
3. remove the lock directory the message names (`rm -r <path>`);
4. sweep again. If step 2 missed a leftover mutant, the pristine check refuses with exit `3`.

Two independent protections, then: the stale lock, and behind it the HEAD-pristine check.
[`mutation-sweep-lock.test.ts`](../../scripts/mutation-sweep-lock.test.ts) runs real sweeps as
separate processes, with a held observer recording the bytes on disk when each test would run:

| Case                                                                                    | Required result                                                                                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A holds the lock at its first baseline; B (M5, same file, same killing test) starts     | B exits `4` with A's pid, never reaches its observer; A observes the HEAD bytes, then exactly M1                                  |
| A has M1 on disk; a CLI sweep starts                                                    | exit `4`, not `3`: the lock is met before any source is read                                                                      |
| 8 sweeps start at once                                                                  | exactly one owns the lock; seven exit `4` with no observation                                                                     |
| `SIGINT` while held at a baseline                                                       | exit `130`, lock released                                                                                                         |
| a linked worktree while the main one is locked                                          | separate lock paths; the linked sweep completes on its own mutant                                                                 |
| `SIGKILL` during a mutant                                                               | lock and mutant remain; sweep and `--validate` exit `4`; after manual removal, exit `3` on the mutant; after restore, a clean run |
| a foreign lock and a dirty tree                                                         | `SweepLockError`, not `SourceIntegrityError`, and the foreign record untouched                                                    |
| normal run · observer throws · failed baseline · refused tree · owner record unwritable | lock released every time, target restored where one was mutated                                                                   |

[`mutation-sweep-isolation.test.ts`](../../scripts/mutation-sweep-isolation.test.ts) builds a
throwaway Git repository per case and runs the production sweep against it, with a counting fake in
place of Vitest:

| Case                                                                                                | Required result                                                                                      |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| M1 left in `a.ts` by a "killed" sweep; a **new process** runs `--only M2`, which still applies once | exit `3`, "not pristine at expected HEAD", no variant line, `a.ts` byte-identical to the stale state |
| the same, in process                                                                                | zero observations: no baseline, no mutant                                                            |
| M1 left in `a.ts`; M3 targets the untouched `b.ts`                                                  | refused, zero observations — CLI and in process                                                      |
| a variant's run dirties another target; the next variant shares its cached baseline                 | aborted after the first variant; the second is never observed                                        |
| HEAD moves during a variant                                                                         | aborted                                                                                              |
| the restore leaves one byte changed                                                                 | aborted by the restore's own verification; the next variant never runs; the next sweep refuses       |
| the restore throws                                                                                  | aborted                                                                                              |
| an `eol=crlf` checkout of an LF blob                                                                | pristine, and restored as CRLF                                                                       |
| untracked target, `../` path, absolute path, symlink, no HEAD                                       | refused                                                                                              |
| a real `SIGTERM` / `SIGINT` while the mutant is on disk                                             | target restored to HEAD bytes and verified, then the lock released; exit `143` / `130`               |

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
| a plain `it` replays the review's exploit through `@moin/testing` (catch `M`, open, confirm `M`, throw `E`)               | `NOT_ELIGIBLE`; no capability reachable from the root or any subpath       |
| a plain `it` registers an `evidenceTest` from inside its own body                                                         | refused by Vitest; `NOT_ELIGIBLE`                                          |
| genuine failures through `not`, `rejects`, `resolves`, and `rejects` on a resolving promise                               | `ASSERTION`                                                                |
| a timeout · a `beforeAll` failure · an `afterEach` failure · the same name in two modules                                 | `TIMEOUT` · hook error, not executed · `UNKNOWN` · distinguished by `file` |

A Vitest upgrade that moves the matcher boundary fails loudly there instead of quietly turning the
corpus into non-evidence.

### The harness's own variants

The `H*` variants attack the harness rather than the audit subsystem: each removes one conjunct of
the rules above and names the adversarial test that must catch it.

Three limits are worth stating rather than hiding.

- `H30`–`H33` re-export a capability or hand the probe out twice; `H34`–`H38` remove one rule of the
  pristine-source contract each; `H39`–`H42` take no lock, take it after the source check, release
  it as soon as it is recorded, and scope it to the whole repository. The sweep that measures them loaded its own code before mutating,
  and checks its targets only before and after each variant, so mutating `mutation-sweep.ts` does not
  change the sweep doing the measuring. Some of these guards are deliberately redundant with each
  other — the per-variant check would also notice a failed restore — so each variant names the test
  that isolates its own term: `H37` is killed because the failure must be reported **by the
  restore**, and `H36` by a direct test of what counts as pristine.
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
