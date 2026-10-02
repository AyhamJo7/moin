# EV-P06-030: KILLED_ASSERTION redefined so it can only mean the intended test, uniquely identified, failing on a genuine typed assertion in a run where nothing else failed

| Field | Value |
|---|---|
| Evidence ID | EV-P06-030 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 15:37 UTC |
| Commit | `986ae8b9dd4b710084194e6c6c99f2a02ac898c4` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.3 s); `pnpm exec prettier --check .` → pass (exit 0, 2.5 s); `pnpm lint` → pass (exit 0, 2.6 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 1.0 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 9.3 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

A fifth independent QG-09 review **accepted** the audit and epoch architecture and found no new
database or security blocker. The only blockers were three defects in the evidence harness, all of
which let `KILLED_ASSERTION` mean less than it claimed. Each was reproduced before being fixed.

## BLOCKER 1 — assertion identity was inferred from mutable error properties

**Reproduced.** An ordinary `Error` decorated with `name = 'AssertionError'` and
`expected`/`actual`/`showDiff`/`ok` was classified `KILLED_ASSERTION` by the previous harness.

**Why the obvious fix is unavailable.** Vitest serializes errors before a reporter sees them. By the
time any verdict is made there is no live `Error` and no prototype to test, so `instanceof` is
unusable — measured: even inside `onTestFailed`, `ctx.task.result.errors` are already serialized
(`isErr: false`). Everything that survives — `name`, `message`, and the four matcher fields — is a
mutable own property that any thrown object can set. `chai` is not resolvable from a setup file, so
patching the assertion constructor was not available either.

**Design: two independent signals, both required.**

| Signal | Source | What it rules out |
|---|---|---|
| `probe.expectCalls` | `expect.getState().assertionCalls`, read in `beforeEach`/`afterEach` by `scripts/mutation-assertion-probe.ts` **inside the test process** and attached to `task.meta` | a failure where no matcher ever ran; throwing an object cannot increment it |
| `error.foreignMarkers` | Vitest's own serializer, which adds `constructor` and `toString` to every error it does **not** own | a decorated foreign object, including one thrown after real `expect` calls |

Measured on Vitest 5.0.2: a genuine `AssertionError` serializes with exactly
`actual, diff, expected, message, name, ok, operator, showDiff, stack, stacks` and **neither**
marker; a plain `Error`, a decorated `Error` and Node's own `assert.AssertionError` all gain both.
The name and all four matcher fields are required on top, so the signature is structural, not
nominal. Anything unclassifiable is `UNKNOWN`, which the classifier turns into a non-evidence
outcome.

The two signals are **not** redundant, and the real-Vitest run is what established it: a test with
passing expectations followed by a decorated throw reports `expectCalls: 2`, so the probe alone
would have accepted it and only the foreign markers reject it.

Classification now happens in the reporter, which emits its own machine-readable verdict
(`REPORT_VERSION = 2`). `scripts/mutation-outcome.ts` consumes only that verdict and the canonical
identity; it reads no error name, message or field. Message text is used for exactly two things,
both of which only ever move a verdict *away* from evidence: recognising
`Test timed out in <n>ms` and recognising a transform or module-resolution failure. The tokens
`expect`, `toThrow`, `assertion` and `matcher` appear in no classification path.

**The serializer behaviour is undocumented, so it is pinned against real Vitest.**
`scripts/mutation-reporter.realvitest.test.ts` (11 tests) spawns a child Vitest with the actual
reporter over real fixture suites in `scripts/__fixtures__/reporter/`. Measured there:

| Fixture | Verdict | `expectCalls` |
|---|---|---|
| genuine `expect(1).toBe(2)` | `ASSERTION` | 1 |
| spoofed assertion object | `ERROR` | 0 |
| passing expects, then a decorated throw | `ERROR` | 2 |
| ordinary thrown `Error` | `ERROR` | 0 |
| a test that times out | `TIMEOUT` | — |
| `beforeAll` failure | hook error 1; the test never executed | — |
| `afterEach` failure beside an assertion | `UNKNOWN` (probe absent) — fails closed | — |
| the same full name in two modules | distinguished by `file` | — |

A Vitest upgrade that changes the serializer fails loudly there instead of silently re-opening the
spoof.

## BLOCKER 2 — the killing test was matched by substring

**Reproduced.** `fullName.includes(expectedTest)` with no module identity was unsound three ways at
once: a same-named test in another file could claim the kill; two tests could match and the first
was taken; `"rejects invalid chain"` matched `"rejects invalid chain after retry"`.

Every manifest entry now carries `killingTest: { file, fullName }`, both compared with `===`. There
is no `includes`, no `startsWith`, no regex, no name-only match. Zero matches is `NO_TEST_MATCH`;
more than one is `AMBIGUOUS_TEST_IDENTITY`. The baseline and the mutant must resolve the same single
identity — the baseline gate requires `matched === 1` — and the baseline cache key is
`[git HEAD, project, file, fullName]`, so a baseline cannot vouch for another tree or another test.
Vitest's `-t` filter is regex-escaped and anchored (`^…$`). A parameterized test is named by one
concrete generated case.

`--validate` refuses a malformed manifest before any test runs: duplicate ids, a missing identity,
a non-existent file, an anchor that is absent, a replacement identical to its anchor, and a name
that `vitest list` does not collect exactly once. Table-driven names are built at run time, so the
collector reports the literal template; those are reported as `deferred` and the baseline gate
enforces uniqueness for real.

**Tightening `--validate` found a latent defect of its own.** The anchor of
`C3-enumeration-failure-reported-clean` resolved to **two** places in `packages/db/src/cli.ts`, and
`String.prototype.replace` with a string pattern rewrites the first — so which guard that variant
attacked was decided by file order. It happened to be the intended one, so no past outcome was
wrong, but it was wrong by luck. The anchor is now unique and `--validate` refuses a non-unique one.

## BLOCKER 3 — an unrelated failure did not disqualify a kill

**Reproduced.** The previous classifier returned `KILLED_ASSERTION` while recording
`unrelatedFailures > 0` in the same object. `KILLED_ASSERTION` now requires all eight of: the
baseline ran and passed cleanly · the report is a version this classifier understands · no
unhandled error · no module error · no hook error · exactly one test carries the identity · it
executed and failed · the reporter typed it `ASSERTION` · and **no other test failed anywhere in
the run**. A run where the intended test asserted *and* something unrelated blew up is
`UNRELATED_FAILURE`, because the unrelated failure may be the reason the intended test failed.

## Taxonomy

Twelve outcomes, exactly as the review prescribed: `KILLED_ASSERTION`, `SURVIVED`,
`BASELINE_FAILED`, `NO_TEST_MATCH`, `AMBIGUOUS_TEST_IDENTITY`, `UNRELATED_FAILURE`,
`INFRA_FAILURE`, `HOOK_FAILURE`, `KILLED_BY_TIMEOUT`, `TIMEOUT`, `BUILD_OR_LOAD_FAILURE`,
`INVALID_MUTANT`, `REPORTER_FAILURE`. Only `KILLED_ASSERTION` is evidence.

## The 18 mandated adversarial self-tests

`scripts/mutation-outcome.test.ts` (29 tests) and `scripts/mutation-reporter.test.ts` (14 tests),
plus the 11 real-Vitest tests above — **54 in total**, all passing.

| # | Case | Outcome asserted |
|---|---|---|
| 1 | spoofed assertion object | NOT `KILLED_ASSERTION` → `INFRA_FAILURE` |
| 2 | the same name in another file | `NO_TEST_MATCH`; and distinguished when both exist |
| 3 | duplicate identity | `AMBIGUOUS_TEST_IDENTITY`, `matched = 2` |
| 4 | substring collision, longer and shorter | `NO_TEST_MATCH` both ways |
| 5 | intended asserts, unrelated throws | `UNRELATED_FAILURE` |
| 6 | intended asserts, unrelated also asserts | `UNRELATED_FAILURE` |
| 7 | intended passes, another fails | `SURVIVED`, 1 unrelated |
| 8 | global setup failure | `INFRA_FAILURE` |
| 9 | `beforeAll` failure, alone and beside an assertion | `HOOK_FAILURE` both ways |
| 10 | `afterEach` failure beside an assertion | NOT a kill → `INFRA_FAILURE` |
| 11 | reporter wrote nothing | `REPORTER_FAILURE` |
| 12 | malformed output; wrong report version | `REPORTER_FAILURE` both ways |
| 13 | truncated output | `REPORTER_FAILURE` |
| 14 | exact clean kill | `KILLED_ASSERTION` — the only shape that counts |
| 15 | survivor | `SURVIVED` |
| 16 | renamed test | `NO_TEST_MATCH` |
| 17 | parameterized cases | binds to one generated case, not a sibling |
| 18 | same exact name in two modules | disambiguated by the manifest file |

The fixtures do not re-implement the thing under test: the helper calls the reporter's **real**
`categoriseTest`, so a fixture cannot drift into agreeing with a copy of the rule. Two apparent
classifier failures during development were bugs in that helper, not in the classifier.

## The harness is itself mutation-proven

Twelve new `H*` variants remove one conjunct of the trust rule each and name the adversarial test
that must catch it. **All twelve are `KILLED_ASSERTION`:**

| Variant | Conjunct removed |
|---|---|
| `H1-classifier-trusts-error-name` | the classifier may not read `error.name` |
| `H2-classifier-ignores-module-identity` | identity includes the module |
| `H3-classifier-matches-by-substring` | the name is compared exactly |
| `H4-classifier-resolves-duplicates-arbitrarily` | exactly one match |
| `H5-classifier-ignores-unrelated-failures` | the run must be clean |
| `H6-classifier-ignores-hook-failures` | a hook that threw is infrastructure |
| `H7-reporter-ignores-foreign-markers` | Vitest's serializer markers |
| `H8-reporter-ignores-the-probe` | `expect` must actually have been called |
| `H9-reporter-trusts-a-stale-probe` | a stale or missing probe fails closed |
| `H10-reporter-accepts-mixed-errors` | every error must be one Vitest owns |
| `H11-reporter-ignores-assertion-fields` | all four matcher fields |
| `H12-reporter-types-by-fields-alone` | the name is part of the signature |

The sweep passes the mutated reporter to the mutated run. That is sound because every `H*` reporter
variant is a **relaxation**: a genuine assertion still types `ASSERTION`, so the kill stays
observable. A tightening would fail closed into a non-evidence outcome rather than report a false
kill.

## Mutation distribution at this HEAD

The corpus was regenerated **end to end**, twice (the second run after correcting two notes), with
identical results. The previous `69/2` over 71 variants is SUPERSEDED.

**`KILLED_ASSERTION: 77` · `INFRA_FAILURE: 2`, over 79 variants** —
`docs/verification/audit-mutation-report.md`.

**Disposition of every non-`KILLED_ASSERTION` outcome.** Both are the two the review asked be kept
as non-evidence, and their recorded reason was **corrected after measurement**. The previous note
claimed they were rejected during the integration project's global setup so that no suite ran. That
is not what happens. Measured by applying each variant and reading the report:

| Variant | What actually happens |
|---|---|
| `N8-backfill-removed` | The killing test is the one that *applies* `0010`. The migration's own guard fires — `audit chain register backfill covered 0 of 3 organisation(s)` — and rolls back, so the test fails on that thrown `Error` after **2** real `expect` calls. |
| `P8-sequence-backfill-removed` | Same shape in `0011`: `column "registration_seq" of relation "audit_chain_registry" contains null values`, after **4** real `expect` calls. |

In both, Vitest marked the error foreign, so the reporter refused to call it an assertion —
correctly. The defect *is* detected, by a guard inside the migration, which is stronger than a test;
it is simply not assertion evidence. Not counted, not rounded up to 79, and the manifest notes now
say this rather than the earlier claim. These two are also the clearest real-world instance of the
blocker-1 shape: real `expect` calls followed by a thrown error, which the probe alone would have
accepted.

No variant was removed or retargeted to improve the number.

## Verified at this HEAD

- `python3 .claude/bin/gates.py full` → **PASS 14/14** at `986ae8b9dd` on a clean tree (0 changed
  files), evidence `.git/claude-evidence/20261001T153547Z-full.json`.
- `node scripts/mutation-sweep.ts --validate` → 79 variants; every anchor unique and resolving,
  every identity collected exactly once, 2 table-driven names deferred to the baseline gate.
- Harness self-tests: 54 passed (29 + 14 + 11).
- Standalone, against a freshly-seeded database: `audit-chain-epoch` 8/8,
  `audit-chain-backfill` 2/2, `audit-verification` 24/24, `cli-verify-audit` 8/8,
  `check-audit-arguments` 27/27.
- `python3 .claude/bin/control_plane_check.py` → OK; `python3 .claude/bin/evidence.py check` → 0
  problems.
- `git diff --check` clean; no mutated source left in the tree.

## Not changed, deliberately

The accepted architecture was not touched: the transactional singleton epoch, commit-order
serialization, high-water semantics, the registration trigger, the migration and backfill, verifier
and scanner traversal, provisioned-but-unregistered reconciliation, and the `SECURITY DEFINER`
controls. No auth or OIDC change. The privacy checker was not expanded further.

ADR-0017 remains **PROPOSED** with its five residuals unchanged. P06.10.03 remains open. P06.10.05
remains `WAITING_FOR_EXTERNAL` on EXT-09 (daily schedule and CloudWatch alarm; founder-owned
Terraform). P06.10 is **not** complete, and PR #31 stays a draft.
