# EV-P06-032: Assertion evidence made the terminal value's object identity rather than a transferable credential, after Object.assign defeated the token design

| Field | Value |
|---|---|
| Evidence ID | EV-P06-032 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 20:16 UTC |
| Commit | `953c47c73bf4767b123356bf79d7c38624d464bd` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.3 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.8 s); `pnpm lint` → pass (exit 0, 2.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 1.0 s); `pnpm test` → pass (exit 0, 5.0 s); `pnpm test:integration` → pass (exit 0, 9.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

The sixth independent QG-09 review found one HIGH blocker: `KILLED_ASSERTION` could still be forged
from a serialized thrown object, because provenance was carried by a **token** on the error. It was
reproduced before anything was changed.

## The blocker, reproduced

```ts
try { expect(1).toBe(2); } catch (e) { caught = e; }
const terminal = new Error('ordinary');
Object.assign(terminal, caught);
throw terminal;
```

Measured against the then-current harness, real Vitest, production reporter: **`ASSERTION`**, with a
valid token on an error no matcher ever threw. `terminal === caught` is `false`, and nothing checked
that.

Making the token non-enumerable, a `Symbol`, random, hashed or signed would have failed identically.
Whatever a test can read off one object it can write onto another; a token is a **credential**, and
credentials transfer. That is five generations of this decision defeated:

| Generation | Authority | How it fell |
| --- | --- | --- |
| 1 | exit code | an unreachable database reported every variant killed |
| 2 | message text | `database connection refused while executing toThrow assertion` counted |
| 3 | `name` + `expected`/`actual`/`showDiff`/`ok` | an `Error` decorated with those fields counted |
| 4 | the above, plus the keys Vitest's serializer adds to foreign errors | a plain object literal has neither key, and counted; so did a `toJSON` spoof |
| 5 | an invocation-scoped token on the matcher's error | `Object.assign` copies it |

Every one read **the thrown value**, which is data authored by the code under test.

## The architecture

**Object identity**, the one property of a value that cannot be transferred.

| Module | Job |
| --- | --- |
| `scripts/mutation-probe-contract.ts` | the shape the probe emits and the reporter reads; no side effects |
| `scripts/mutation-evidence-state.ts` | the module-private `WeakMap` and every decision about it; no side effects |
| `scripts/mutation-evidence-probe.ts` | the `setupFiles` entry: the matcher boundary, and invocation windows |
| `scripts/mutation-evidence-test.ts` | `evidenceTest`, the trusted wrapper |

**The private map.** `const matcherFailures = new WeakMap<object, MatcherFailure>()` in
`mutation-evidence-state.ts`. It is never exported, and no reader for it is exported either — not a
getter, not a `has`, not an iterator. The only question answerable from outside is the one
`confirmTerminal` answers, about one exact object. Values are `{ invocationId, file, fullName,
matcher, seq }`.

**The matcher boundary.** Every function on `Assertion.prototype` is wrapped (measured: 185 own
properties, matchers writable and configurable); on a throw it hands the object to the recorder,
which uses it as a `WeakMap` key and **does not touch it**. The `rejects`/`resolves` getters are
wrapped too, because Vitest raises "promise resolved instead of rejecting" from inside its own async
chain without running a matcher. `installMatcherRecorder()` hands out the record function **once** —
the probe is the caller; a second caller throws — so a test cannot register an object of its own.

**The terminal value.**

```ts
try { await body(context); }
catch (terminal) { confirmTerminal(terminal); throw terminal; }
```

`confirmTerminal` is `===` against the private map, then the invocation id, then the test identity,
then exactly one matcher failure. The error is rethrown unchanged, so a wrapped test fails, reports
and reads exactly as it would have.

**No credential anywhere.** `scripts/mutation-evidence-probe.test.ts` asserts that none of
`matcherToken`, `MATCHER_FAILURE_TOKEN`, `failureTokens` appears in any of the seven production
harness files; that `record` contains no `defineProperty` and no `Object.assign`; that the map and
every reader of it are unexported; and that the verdict function mentions none of `foreignMarkers`,
`assertionFields`, `'AssertionError'`, `expected`, `showDiff`, `constructor`, `toString`, `stack`,
`matcherToken` or `expectCalls`.

## Why a wrapper, and what it costs

Measured on Vitest 5.0.2, and this is what decided the design:

| Interception point | Live object available? |
| --- | --- |
| `afterEach` via `task.result.errors[0]` | **no** — serialized plain object, `instanceof Error` false, constructor undefined |
| `onTestFailed` via `task.result.errors[0]` | **no** — same |
| `onTestFailed` context `errors` | not present (`ctx` keys: signal, task, skip, annotate, onTestFailed, onTestFinished) |
| `task.fn` replaced from `beforeEach` | **no** — `task.fn` is `undefined` on the task at hook time |
| a custom runner | `runner?: string` exists, but Vitest 5 exports no base runner class to extend |
| inside the test callback | **yes** |

So the terminal value is reachable only inside the callback, and only a wrapped test can be
eligible. The cost is explicit: a test registered with plain `it` runs and fails exactly as before
but cannot bear evidence, and a manifest entry naming one is reported `NOT_EVIDENCE_ELIGIBLE` rather
than counted or hidden among infrastructure failures.

**What was migrated:** the harness's own test files and `scripts/check-audit-arguments`,
`scripts/check-rls-catalog`, `scripts/check-data-classification` — 50 variants' killing tests,
including the table-driven block, which keeps its exact generated names.

**What was not, and why:** the 42 variants whose killing tests live under `packages/db/`. This round
was instructed not to modify that directory, and report item 28 asks for confirmation that it is
unchanged, so they stay ineligible and are reported as such. Of those 42, **40 would become
`KILLED_ASSERTION` with a one-line change per test** (import `evidenceTest`, use it in place of
`it`). `N8-backfill-removed` and `P8-sequence-backfill-removed` would **not**: nothing in them fails
a matcher at all, because their control is an assertion inside the migration — `0010` raising
`audit chain register backfill covered 0 of 3 organisation(s)` and `0011` failing `NOT NULL` — and
the test fails on that thrown database error. That is a stronger control than a test; it is simply
not assertion evidence.

Editing `packages/db/` is the founder's call. Nothing here depends on it.

## Mandatory real-Vitest regressions

`scripts/mutation-reporter.realvitest.test.ts` — **25 tests**, spawning a child Vitest with **the
production probe, the production wrapper, the production reporter and the production
`categoriseTest`** over real fixtures. Nothing is reimplemented in the test.

| # | Attack | Result |
| --- | --- | --- |
| 1 | `Object.assign(new Error('ordinary'), caught)` | **`ERROR`** — "a copy is not the same object"; the invocation's own matcher record does not vouch for it |
| 2 | every own property **and** `getOwnPropertySymbols` copied via `defineProperty` | **`ERROR`** |
| 3 | a clone with the same prototype, name, message and stack | **`ERROR`** |
| 4 | catch, `await`, then throw a copy | **`ERROR`** |
| 5 | the same matcher object rethrown immediately | **`ASSERTION`** |
| 6 | the same matcher object thrown later in the same invocation | **`ASSERTION`** — the intended semantics, while exactly one matcher failed |
| 7 | a swallowed matcher failure, then an ordinary error | **`ERROR`** |
| 8 | test A's matcher object thrown in test B | **`ERROR`** — "belongs to invocation …-1, not …-2" |
| 9 | the first attempt's matcher object thrown on the retry (`{ retry: 1 }`) | **`ERROR`** — a retry is a new invocation |
| 10 | parameterized case A's object thrown in case B | **`ERROR`**, while case A is `ASSERTION` |
| 11 | two matcher failures in one invocation | **`ERROR`** — "cannot be established" |
| 12 | concurrent invocations (`it.concurrent`) | **`UNKNOWN`** both — overlapping windows detected and marked suspect |

Plus: the four shapes that defeated generations 3 and 4 (plain object literal, `toJSON` spoof,
successful `expect` then a throw with `expectCalls: 2`, Node's own `assert.AssertionError`) all
`ERROR` with **zero** matcher failures; a forged `task.meta` record, complete and consistent,
overwritten; an unwrapped genuine matcher failure `NOT_ELIGIBLE`; `not`/`rejects`/`resolves` and
`rejects` on a resolving promise all `ASSERTION`; timeout, `beforeAll`, `afterEach` and the
two-modules-one-name case as before.

## The old H1–H25, dispositioned

| Old variant | Disposition |
| --- | --- |
| reporter: stale version, suspicion, rejected records, record identity, ambiguous count, timeout precedence | **KEEP** → `H3`, `H4`, `H5`, `H6`, `H7`, `H9` |
| reporter: trusts serialized assertion shape | **REWRITE** → `H1`, anchored on the new provenance block, killed by the real-Vitest plain-object case |
| reporter: skips the trusted event | **REWRITE** → `H2`, now `MATCHER_IDENTITY_CONFIRMED` |
| reporter: ignores foreign markers / assertion fields / types by fields alone | **REMOVE_OBSOLETE** — those fields are no longer read anywhere |
| reporter: accepts a swallowed assertion / accepts any token | **REMOVE_OBSOLETE** — token-based; replaced by `H10`, which attacks the identity check itself |
| probe: treats `expectCalls` as provenance | **REMOVE_OBSOLETE** — the event no longer derives from any count; `H13` covers eligibility instead |
| probe: token not invocation-scoped (`H12`) | **REMOVE** — the review was right that its stated replay defect was false: dropping the invocation id left the globally advancing sequence unique, so no replay was possible. Replaced by `H11`, which ignores the invocation binding in the `WeakMap` and is killed by an actual cross-test replay |
| probe: does not stamp the propagating error | **REMOVE_OBSOLETE** — nothing is stamped |
| probe: ignores overlapping invocations | **KEEP**, moved to the state module → `H15` |
| probe: window admits the previous invocation | **KEEP**, moved → `H14` |
| probe: lets a forged record stand | **KEEP** → `H16` |
| sweep: anchor uniqueness, no-op mutant, missing anchor, literal splice | **KEEP** → `H19`–`H22` |
| classifier: error name, module identity, substring, duplicates, unrelated failures, hook precedence | **KEEP** → `H23`–`H28` |

**New variants for the new model:** `H8` (ignores evidence eligibility), `H10` (skips the terminal
identity check — the copy attack would succeed), `H11` (ignores invocation binding — actual replay),
`H12` (accepts multiple matcher failures), `H13` (treats every test as eligible), `H29` (folds
ineligibility into infrastructure so a reach gap looks like a flaky database).

**Two candidates removed rather than retained as fake evidence**, exactly as the review instructed:
removing `confirmTerminal` from the wrapper, and removing `beginEvidence`. Both stop *any* test
producing `ASSERTION`, so the harness cannot report its own kill — measured: `INFRA_FAILURE` and
`NOT_EVIDENCE_ELIGIBLE` respectively. The real-Vitest suite asserts both invariants directly
instead. The `H*` numbering is not resequenced after the removals, so the manifest, the report and
this record agree.

## Mutation distribution at this HEAD

**`KILLED_ASSERTION: 52` · `NOT_EVIDENCE_ELIGIBLE: 42`, over 94 variants.** `90/2 over 92` is
superseded. No `SURVIVED`, `UNRELATED_FAILURE`, `AMBIGUOUS_TEST_IDENTITY`, `NO_TEST_MATCH`,
`INVALID_MUTANT`, `INFRA_FAILURE`, `TIMEOUT` or `REPORTER_FAILURE`.

The number went down because the standard went up. Every one of the 42 non-evidence rows is a
`packages/db/` killing test and nothing else — verified against the machine-readable results, not
assumed.

Killed, by killing-test file: `check-audit-arguments.integration.test.ts` 18 ·
`check-rls-catalog.integration.test.ts` 6 · `check-data-classification.test.ts` 1 ·
`mutation-reporter.test.ts` 8 · `mutation-reporter.realvitest.test.ts` 8 ·
`mutation-outcome.test.ts` 7 · `mutation-sweep.test.ts` 4.

## Preserved, not regressed

Exact `{ file, fullName }` identity with `===` on both halves; `0 → NO_TEST_MATCH`,
`>1 → AMBIGUOUS_TEST_IDENTITY`; `unrelatedFailures === 0`; reporter fail-closed on missing,
malformed, truncated and wrong-version output; baseline cleanliness with the HEAD-scoped cache key;
parameterized exact identity; and `applyMutation`'s four refusals with the positional splice. Each
is still mutation-proven (`H3`, `H19`–`H28`).

## Verified at this HEAD

- `python3 .claude/bin/gates.py full` → **PASS 14/14** at `953c47c73b`, evidence
  `.git/claude-evidence/20261001T201540Z-full.json`. The matcher instrumentation and the wrapper are
  loaded by every unit and integration test in the repository, and the whole suite passes unchanged.
- `node scripts/mutation-sweep.ts --validate` → 94 variants; every anchor unique and resolving,
  every identity collected exactly once, 2 table-driven names deferred to the baseline gate.
- Harness self-tests: **93 passed** — 31 classifier, 15 reporter, 25 real-Vitest, 9 mutation
  application, 13 probe/provenance.
- `control_plane_check.py` → OK; `evidence.py check` → 0 problems.
- `git diff --check` clean; no mutated source left in the tree.

## Not changed, deliberately

`git diff ea0d103..HEAD` touches **no file under `packages/db/` or `apps/`**. The transactional
singleton epoch, commit-order serialization, high-water semantics, registration bypass controls,
verifier and scanner traversal, migration and backfill, and the privileged-function controls are
byte-identical. No auth or OIDC change; the privacy checker was not expanded.

ADR-0017 remains **PROPOSED** with its five residuals unchanged. P06.10.03 remains open. P06.10.05
remains `WAITING_FOR_EXTERNAL` on EXT-09. P06.10 is `IN_PROGRESS`, not complete, and P06.10.07 is
`READY_FOR_REVIEW` — never `VERIFIED` by the implementor. PR #31 stays a draft.
