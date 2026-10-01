# EV-P06-034: Evidence capabilities made module-private so a plain test cannot open eligibility or confirm a caught matcher object, and the sweep refuses to measure any tree whose mutation targets are not the HEAD blobs

| Field | Value |
|---|---|
| Evidence ID | EV-P06-034 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 23:16 UTC |
| Commit | `6b3d45a7b71f1ca7d93f8f7e00d566c289f52ff7` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 3.0 s); `pnpm lint` → pass (exit 0, 8.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.9 s); `pnpm typecheck` → pass (exit 0, 4.3 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 9.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

The independent QG-09 review of `4bc9f44` found exactly two remaining blockers. Both are harness-only;
no product code, migration, app or auth path changed (`git diff --stat 4bc9f44..HEAD -- packages/db apps`
is empty).

## Blocker 1 — the evidence capabilities were public

### Reproduced

`scripts/__fixtures__/reporter/public-capability.fixture.ts` is a plain `it` test — no `evidenceTest`
— that imports `* as testing from '@moin/testing'`, catches a genuine matcher object `M`, calls
`beginEvidence()` and `confirmTerminal(M)` if the root exposes them, and throws an unrelated
`Error`. Against `4bc9f44`, through the production probe and reporter in a child Vitest:

| Test | failureCategory | probe.event |
| --- | --- | --- |
| replays the exploit through the public API | **`ASSERTION`** | **`MATCHER_IDENTITY_CONFIRMED`** |
| catches `M`, throws `E`, no capability used | `NOT_ELIGIBLE` | `NON_EVIDENCE` |

The terminal message listed what the root exposed: `beginEvidence`, `confirmTerminal`,
`installMatcherRecorder`, `openInvocation`, `closeInvocation`. The regression in
`mutation-reporter.realvitest.test.ts` failed (`expected 'ASSERTION' not to be 'ASSERTION'`).

### Why removing the re-exports was not enough

`@moin/testing`'s `exports` map already refused every subpath (`./src/…`, `./mutation/…`,
`./internal`, `./probe`, even `./package.json` — measured). But an `export` anywhere in the repository
is reachable by a relative import, and a map only governs the package name. Keeping `beginEvidence`
and `confirmTerminal` exported from `evidence-state.ts` "for the wrapper" would have left the exploit
one `../../` away.

### The fix

- `beginEvidence`, `confirmTerminal` and `intercept` (the `try { body } catch (T) { confirm(T);
  throw T }` wrapper) are module-scoped in `evidence-state.ts` and **exported from no module**.
  `evidenceTest` and `concurrentEvidenceTest` are defined beside them, so the only path to the
  capabilities is a *registration* call. Vitest refuses to register a test from inside a running one
  — measured by the fixture's third case — so a test body cannot use `evidenceTest` to wrap itself.
- The probe's needs (recorder, window open/close) are handed out together by `installProbe()`, once.
  The probe is a setup file, takes them by relative import before any test module loads, and a
  second caller gets an exception. Nothing in that bundle can open eligibility or confirm a value.
- `evidence-test.ts` is the public face and re-exports registration only. The root exports an
  allow-list: factories, fault injection, the clock, `evidenceTest`, `concurrentEvidenceTest` (used
  by the concurrency-rejection fixture), and the inert contract constants
  (`MATCHER_IDENTITY_CONFIRMED`, `NON_EVIDENCE`, `PROBE_META_KEY`, `PROBE_VERSION`) the reporter reads.
  The unused `mutationEvidenceTest` alias was dropped.
- Terminal identity is unchanged: private `WeakMap<object, MatcherFailure>`, `T === M`, no token, no
  shape heuristic.

### Regression

After the fix the same fixture reports `NOT_ELIGIBLE`, `evidenceEligible: false`,
`matcherFailures: 1`, and `capabilities reached: none` — from the root and from every subpath tried.
`scripts/testing-export-surface.test.ts` pins: the `exports` map is exactly `{ ".": "./src/index.ts" }`
with no `main`/`module`/`imports`; six subpaths reject; the root's keys equal the allow-list; the
state module's keys are exactly `concurrentEvidenceTest`, `evidenceTest`, `installProbe`;
`installProbe()` throws in a test; the relative import and the package name share one module
instance; every occurrence of a capability name in a tracked or new source file is in a classified
file; and the only import of a capability anywhere is `installProbe` in the probe.

### Static audit of the names

| Name | Where it occurs | Classification |
| --- | --- | --- |
| `beginEvidence` | `evidence-state.ts` (definition, one call in `intercept`); `evidence-test.ts` (docblock) | internal implementation |
| `confirmTerminal` | `evidence-state.ts`; `evidence-test.ts` (docblock); `mutation-reporter.ts` (comment) | internal implementation |
| `installProbe` | `evidence-state.ts`; `mutation-evidence-probe.ts` (the one importer); `index.ts`/`evidence-test.ts` (comments) | trusted setup |
| all four | `mutation-evidence-probe.test.ts`, `testing-export-surface.test.ts`, `public-capability.fixture.ts` | dedicated harness tests / attack fixture |
| `installMatcherRecorder` | the attack fixture and the surface test only | retired name |

No product or ordinary test file names any of them.

## Blocker 2 — a killed sweep contaminated the next one

### Reproduced

The sweep read each target with `readFileSync` as its "original", mutated in place and restored in
`finally`. `SIGKILL` skips `finally`. `mutation-sweep-isolation.test.ts` builds the review's scenario
in a throwaway Git repository: M1 is applied to `src/a.ts` and not restored; M2 targets the same file,
its anchor still resolves exactly once (asserted), and the stale tree is ordinary source. At
`4bc9f44` nothing compared the file with HEAD, so M2 would have been baselined and mutated on top of M1.

### The pristine-source contract

1. **Before anything runs** — baseline, cache lookup or mutation — `git rev-parse --verify HEAD^{commit}`
   is resolved, and every target named anywhere in the manifest (not only the selected variants') is
   hashed with `git hash-object --path=<file> --stdin` and compared with its blob from
   `git ls-tree -z --full-tree HEAD -- <file>`. `--path` applies the path's `eol`/clean filters, so a
   CRLF checkout of an LF blob is pristine — a byte comparison with `git show HEAD:path` would have
   called it dirty. A target must be a tracked regular file (`100644`/`100755`) with a plain
   repository-relative path. Any difference: `SourceIntegrityError`, exit `3`, **nothing changed**.
2. **Per variant**, the bytes captured for restore are the bytes that were hashed (one read). After the
   mutant run they are written back, re-read, and must equal the captured bytes **and** hash to the HEAD
   blob; then every target is re-checked and HEAD must not have moved. Any failure aborts the sweep;
   the next variant never runs.
3. The baseline cache (key `[HEAD, project, file, fullName]`) is reached only after rule 1 and the
   previous variant's rule-2 checks.
4. `SIGINT`/`SIGTERM` kill the active Vitest child, restore and verify the active target, exit
   `130`/`143`. `SIGKILL` cannot be handled; the protection is rule 1 on the next run.
5. `--validate` runs rule 1 first, so validation is never more permissive than execution.
   Consequence: **commit before sweeping.**

Git commands run with every `GIT_*` variable removed, so a sweep started from a hook cannot be pointed
at another repository.

### Regressions (`scripts/mutation-sweep-isolation.test.ts`, 15 tests)

| Case | Result |
| --- | --- |
| stale M1 in `a.ts`; **new process** `--only M2` | exit `3`, "not pristine at expected HEAD … src/a.ts", "Sweep refused to run", no variant line, `a.ts` byte-identical to the stale state |
| same, in process | 0 observations |
| stale M1 in `a.ts`; M3 targets untouched `b.ts` (in process and CLI) | refused, 0 observations, `b.ts` unchanged |
| a variant's run dirties another target; next variant shares the cached baseline | aborted after the first; observations `baseline:M1, mutant:M1` only |
| HEAD moves during a variant | aborted |
| restore leaves one byte changed | aborted **by the restore's own verification**; next variant never observed; a fresh sweep then refuses |
| restore throws | aborted |
| clean run | three variants, one cached baseline, each mutant alone on the HEAD bytes, files back to HEAD |
| `eol=crlf` checkout | pristine; restored as CRLF |
| untracked, `../`, absolute, symlink (`120000`), no HEAD | refused |
| real `SIGTERM` / `SIGINT` while the mutant is on disk (separate Node process) | restored and verified; exit `143` / `130` |

`applyMutation`'s rules are unchanged (zero, many or empty anchor, identical replacement →
`INVALID_MUTANT`; positional splice); `mutation-sweep.test.ts` still covers them, and `H19`–`H22`
still kill.

## New harness self-mutations

Nine `H*` variants, each removing one guard added here and naming the test that must reject it. All
nine came back `KILLED_ASSERTION`, first individually with `--only` and then in the full sweep.

| Variant | Removes | Killing test |
| --- | --- | --- |
| `H30-state-exports-begin-evidence` | `beginEvidence` exported from the state module | surface: the state module's export list |
| `H31-state-exports-confirm-terminal` | `confirmTerminal` exported | same |
| `H32-root-reexports-a-capability` | the root re-exports `installProbe` | surface: the root allow-list |
| `H33-state-hands-the-probe-out-twice` | the one-shot guard on `installProbe` | surface: a test cannot take the probe |
| `H34-sweep-skips-the-startup-pristine-check` | the pre-sweep all-target check | isolation: stale mutant in another file |
| `H35-sweep-checks-only-the-selected-targets` | all targets → selected variants' targets only | same |
| `H36-sweep-trusts-the-working-tree-as-original` | the HEAD-blob comparison in `capturePristine` | isolation: "is the HEAD blob, not whatever the working tree holds" |
| `H37-sweep-skips-the-restore-verification` | the post-restore byte and blob check | isolation: one-byte-off restore must be reported **by the restore** |
| `H38-sweep-continues-after-a-failed-restore` | abort-on-failure, replaced by `continue` | isolation: next variant must never be observed |

Some of these guards are deliberately redundant: the per-variant all-target check would also notice a
failed restore. A variant that only removed a redundant term would survive and say nothing, so each
names a test that isolates its own term. Self-observation is sound because the measuring sweep loaded
its code before mutating it and checks its targets only before and after each variant. "Plain test
treated as evidence-enabled" was already `H13`, which still kills.

Not added: removing the `!invocation.eligible` branch inside `confirmTerminal`. That function is
now reachable only through `intercept`, which always opens eligibility first, so the branch cannot
change any observable outcome. That variant would be an equivalent mutant.

## Proofs

| Check | Result |
| --- | --- |
| `mutation_check.py --fix-ref 7a8adc3` (4 fix files) against the real-Vitest "plain test with only the public API" tests | **KILLED**: fails without the fix, passes with it, restored byte-identical |
| `mutation_check.py --fix-ref 54bf666` (`scripts/mutation-sweep.ts`) against the restart and cross-file tests | **KILLED** |
| `gates.py stress`, 20 iterations over the 7 harness suites | 20/20 PASS |
| harness suites | 120 tests: realvitest 28, outcome 31, reporter 15, probe 13, isolation 15, surface 9, sweep 9 |
| `pnpm test` (unit) | 39 files, 435 tests |
| `packages/db` focused evidence suites | 63 tests, unchanged: `audit-verification` 24, `cli-verify-audit` 8, `audit-chain-population` 10, `audit-chain-epoch` 8, `audit-chain-backfill` 2, `audit` 11 |
| object-identity provenance fixtures | unchanged and passing: copy, every property and symbol, clone, async copy, swallowed matcher, cross-test, retry, parameterized and concurrent replay, two failures, forged `task.meta` |

## Mutation corpus, regenerated

`--validate` at `52cc10f`: 103 variants, every anchor resolves, every killing test is named exactly
(2 table-driven names confirmed at baseline). Full sweep at `52cc10f`, with every target proved to be
its HEAD blob before the sweep, after every variant and on every restore:

- **KILLED_ASSERTION: 101**
- **NOT_EVIDENCE_ELIGIBLE: 2**: `N8-backfill-removed` and `P8-sequence-backfill-removed`, unchanged
  and correct. A guard inside the migration (`0010` backfill refusal, `0011` `NOT NULL`) detects the
  defect, so no matcher throws.

No variant had a failed baseline. The previous `92/2 over 94` is superseded; the new number is the old
92 plus the 9 new `H*` variants, and none of the old 94 changed outcome.

A first attempt at the sweep was started without the environment file, so the integration project's
global setup could not reach the database. Every integration variant came back `BASELINE_FAILED`
("the run collected no tests at all"), and none was counted as a kill. It was rerun with
`--env-file=.env.example`, which holds the local stack's documented defaults, and that run is the one
reported. The README now gives the exact invocation.

## Scope held

`git diff --stat 4bc9f44..HEAD -- packages/db apps` is empty, so there are no product, migration,
app or auth changes. ADR-0017 stays **PROPOSED**, and the PLAN Status Ledger is unchanged. PR #31
stays a draft.
