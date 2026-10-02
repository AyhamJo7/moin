# EV-P06-033: Every killing test registered through the trusted evidence wrapper, registration only, with the wrapper relocated to @moin/testing so no package reaches into scripts

| Field | Value |
|---|---|
| Evidence ID | EV-P06-033 |
| Item | P06.10.07 |
| Date (UTC) | 2026-10-01 21:08 UTC |
| Commit | `bf022008a1d26e54e320bad020832fa964b4269d` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.2 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.4 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.9 s); `pnpm exec prettier --check .` → pass (exit 0, 3.8 s); `pnpm lint` → pass (exit 0, 3.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 1.3 s); `pnpm test` → pass (exit 0, 6.3 s); `pnpm test:integration` → pass (exit 0, 11.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.4 s); `node scripts/check-licences.ts` → pass (exit 0, 0.6 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.6 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

The object-identity provenance architecture was accepted. The only open item was the eligibility gap
the previous round's scope created: 42 variants were `NOT_EVIDENCE_ELIGIBLE` because their killing
tests live under `packages/db/`, which that round was told not to modify. Test files there are now in
scope; product code is not.

## Classification of the 42, before editing

All 42 use plain `it('…')` with a **literal** name — none is table-driven, so no parameterized
wrapper adapter was needed anywhere in `packages/db`. By killing-test file:

| File | Variants | Disposition |
| --- | --- | --- |
| `audit-verification.integration.test.ts` | 22 | MIGRATE |
| `cli-verify-audit.integration.test.ts` | 9 | MIGRATE |
| `audit-chain-population.integration.test.ts` | 7 | MIGRATE |
| `audit-chain-epoch.integration.test.ts` | 2 | MIGRATE |
| `audit-chain-backfill.integration.test.ts` | 2 | **KEEP_NON_EVIDENCE** (`N8`, `P8`) |

40 → `MIGRATE_TO_EVIDENCE_TEST`, 2 → `KEEP_NON_EVIDENCE`. The 40 name **30 distinct tests** — several
variants legitimately share one killing test (four alarm variants share "raises a SEV2 alarm with its
runbook and a distinct exit code on a break", for instance).

The eligibility judgement was not taken on faith. The migration changed registration only, and the
full regeneration is what established that each test terminates on a genuine matcher failure: all 40
came back `KILLED_ASSERTION` on their own. Had any not, it would have been reported as it came out
rather than rewritten into a kill.

## The migration

`it(` → `evidenceTest(` on exactly those 30 tests. Nothing else. Proven mechanically rather than
asserted: with both registration forms collapsed to one and formatting ignored, each file's content
is **identical** to its state at `15899fca`, and each file's `@moin/testing` import differs by
exactly `evidenceTest,`.

| File | Renames | Body |
| --- | --- | --- |
| `audit-chain-epoch.integration.test.ts` | 2 | identical |
| `audit-chain-population.integration.test.ts` | 6 | identical |
| `audit-verification.integration.test.ts` | 17 | identical |
| `cli-verify-audit.integration.test.ts` | 5 | identical |

Names, full names, bodies, assertions, setup, database work and timeouts are preserved; the two
tests that pass a bare `60_000` timeout keep it, normalised by the wrapper into Vitest 5's
second-argument `{ timeout }` form. Suite counts are unchanged: `audit-verification` 24,
`cli-verify-audit` 8, `audit-chain-population` 10, `audit-chain-epoch` 8, `audit-chain-backfill` 2,
`audit` 11. Every manifest `{ file, fullName }` identity still resolves, and `--validate` confirms
each is collected exactly once.

The only non-mechanical change in the diff is prettier's reindentation, because `evidenceTest(` is
longer than `it(` and the call wraps.

## One structural change, and why

The wrapper lived in `scripts/`. A relative import from `packages/db/src/` into `scripts/` is
precisely the deep path this repository's own boundary test calls out — *"no reviewer would accept
and no developer would write"* (`packages/config/src/boundaries/boundaries.test.ts`). So three
modules moved:

| From | To |
| --- | --- |
| `scripts/mutation-probe-contract.ts` | `packages/testing/src/mutation/probe-contract.ts` |
| `scripts/mutation-evidence-state.ts` | `packages/testing/src/mutation/evidence-state.ts` |
| `scripts/mutation-evidence-test.ts` | `packages/testing/src/mutation/evidence-test.ts` |

and are re-exported from `@moin/testing` — the same door `createTestDatabase` already comes through
in these very files. `scripts/mutation-evidence-probe.ts`, the Vitest setup file, stays with the rest
of the harness because only the config and the sweep reference it.

This is a relocation, not a redesign: the private `WeakMap`, the recorder-install guard, the matcher
prototype patch, the window bookkeeping and the `T === M` check are byte-for-byte the same code. Six
manifest anchors were repointed at the new paths and all six still resolve uniquely.
`pnpm exec depcruise` reports **no dependency violations over 197 modules, 486 dependencies**, and
the `boundaries` gate passes.

## N8 and P8 remain non-evidence

Deliberately not migrated, and `audit-chain-backfill.integration.test.ts` was not touched at all.

| Variant | Why it is not assertion evidence |
| --- | --- |
| `N8-backfill-removed` | `0010` raises `audit chain register backfill covered 0 of 3 organisation(s)` and rolls back. The killing test is the one that *applies* the migration, so it fails on a thrown database error; no matcher throws. |
| `P8-sequence-backfill-removed` | `0011` fails on `column "registration_seq" of relation "audit_chain_registry" contains null values` and rolls back. The `NOT NULL` constraint is the control. |

Both defects **are** detected, by a guard inside the migration, which is a stronger control than a
test assertion — it refuses the migration rather than reporting afterwards. Wrapping the tests would
not change the terminal value, and rewriting them to catch the error and `expect()` it would be
manufacturing evidence rather than finding it. They stay `NOT_EVIDENCE_ELIGIBLE`, outside the
`KILLED_ASSERTION` numerator, with that reason recorded in the manifest's `note` and printed in the
report.

## Provenance architecture unchanged

No token returned; no serialized-error heuristic returned. Still:

- a module-private `WeakMap<object, MatcherFailure>`, never exported and with no reader exported;
- the matcher wrapper records the thrown object as a key and **writes nothing onto it**;
- the trusted wrapper catches the terminal value before Vitest serializes it and requires
  `terminal === M`, then the invocation id, then the test identity, then exactly one matcher failure.

`git diff` over `packages/testing/src/mutation/` versus the old `scripts/` files shows only the three
internal import paths changing. `H11-state-ignores-invocation-binding` — the corrected behavioural
replay mutant — is unchanged, and no obsolete token mutant was reintroduced.

All attack cases re-run against real Vitest and still refused:

| Attack | Result |
| --- | --- |
| catch M, copy every own property onto E, throw E | **non-evidence** |
| catch M, copy every own property **and symbol** onto E | **non-evidence** |
| clone with the same prototype, name, message, stack | **non-evidence** |
| catch M, `await`, throw a copy | **non-evidence** |
| swallow M, then throw an ordinary error | **non-evidence** |
| M from another test | **non-evidence** — invocation mismatch |
| M from the previous retry (`{ retry: 1 }`) | **non-evidence** |
| M from another parameterized case | **non-evidence**, while the case that earned it is evidence |
| two matcher failures in one invocation | **non-evidence** |
| concurrent invocations | **non-evidence** — overlap detected |
| **`throw M` in the same invocation** | **eligible** |
| plain assertion-shaped object · `toJSON` spoof · successful `expect` then throw · Node `assert.AssertionError` · forged `task.meta` record | **non-evidence**, all five |

## Mutation distribution at this HEAD

Regenerated from scratch, all 94 variants.

**`KILLED_ASSERTION: 92` · `NOT_EVIDENCE_ELIGIBLE: 2`.** `52/42` is superseded. No `SURVIVED`,
`INFRA_FAILURE`, `REPORTER_FAILURE`, `AMBIGUOUS_TEST_IDENTITY`, `NO_TEST_MATCH`, `UNRELATED_FAILURE`,
`TIMEOUT`, `KILLED_BY_TIMEOUT`, `BUILD_OR_LOAD_FAILURE` or `INVALID_MUTANT`.

The two are exactly `N8` and `P8` — verified against the machine-readable results, not assumed. Both
have `baseline: PASSED`, `matched: 1`, `unrelatedFailures: 0`: the manifest entry is sound and the
test is sound; only the terminal value is not a matcher's.

Killed, by killing-test file: `audit-verification` 22 · `check-audit-arguments` 18 ·
`cli-verify-audit` 9 · `mutation-reporter` 8 · `mutation-reporter.realvitest` 8 ·
`audit-chain-population` 7 · `mutation-outcome` 7 · `check-rls-catalog` 6 · `mutation-sweep` 4 ·
`audit-chain-epoch` 2 · `check-data-classification` 1.

## Verified at this HEAD

- `python3 .claude/bin/gates.py full` → **PASS 14/14** at `bf022008a1`, evidence
  `.git/claude-evidence/20261001T210729Z-full.json`.
- `node scripts/mutation-sweep.ts --validate` → 94 variants; every anchor unique and resolving,
  every identity collected exactly once, 2 table-driven names (in `scripts/`) deferred to the
  baseline gate.
- Harness trust suite: **93 passed** — 31 classifier, 15 reporter, 25 real-Vitest, 9 mutation
  application, 13 probe/provenance.
- `packages/db` focused, standalone against a freshly-seeded database: `audit-chain-epoch` 8/8,
  `audit-chain-population` 10/10, `audit-chain-backfill` 2/2, `audit-verification` 24/24,
  `audit` 11/11, `cli-verify-audit` 8/8.
- `pnpm exec depcruise apps packages scripts` → no violations, 197 modules.
- `control_plane_check.py` → OK; `evidence.py check` → 0 problems.
- `git diff --check` clean; no mutated source left in the tree.

## Product code unchanged

`git diff 15899fca..HEAD` under `packages/db` touches **four files, all `*.integration.test.ts`**.
`packages/db/migrations/*` and every non-test `packages/db/src/*.ts` are byte-identical — the diff
is empty for them. `apps/` has **zero** changed files. The transactional singleton epoch, commit-order
serialization, high-water semantics, registration bypass controls, verifier and scanner traversal,
migration and backfill, and the privileged-function controls are untouched.

During the sweep an on-disk production file does appear modified; that is the harness holding a
variant mid-run and restoring it in a `finally`. It was re-checked after the sweep and at the
committed HEAD, and both are clean.

ADR-0017 remains **PROPOSED** with its five residuals unchanged. P06.10.03 remains open. P06.10.05
remains `WAITING_FOR_EXTERNAL` on EXT-09. P06.10 is `IN_PROGRESS`, not complete, and P06.10.07 is
`READY_FOR_REVIEW` — never `VERIFIED` by the implementor. PR #31 stays a draft.
