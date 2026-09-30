# Verification artifacts

## The audit mutation sweep

- **Manifest:** [`audit-mutation-manifest.json`](audit-mutation-manifest.json) — the defective
  variants, as data.
- **Latest report:** [`audit-mutation-report.md`](audit-mutation-report.md) — one row per variant
  with its verdict.
- **Runner:** [`../../scripts/mutation-sweep.ts`](../../scripts/mutation-sweep.ts)
- **Invariants:** INV-01, INV-10, INV-12 · **Review:** QG-09

A test that has never been made to fail is a hope, not a control. Every guard in the audit
subsystem therefore has at least one **defective variant**: a named, minimal edit that would
reintroduce the defect the guard exists to prevent. The sweep applies each one to the working tree,
runs only the test that must catch it, requires a non-zero exit, and restores the file byte-for-byte
from memory.

```
node scripts/mutation-sweep.ts --validate     # anchors resolve; changes nothing, runs nothing
node scripts/mutation-sweep.ts                # the full sweep
node scripts/mutation-sweep.ts --only B4-1-head-and-orphan-read-in-two-statements
node scripts/mutation-sweep.ts --report docs/verification/audit-mutation-report.md
```

It needs the local stack (`pnpm dev:up`) and the environment file, like any integration run.

### Why the manifest is data rather than a number

"54 variants, 54 killed" tells a reviewer nothing about _coverage_ — which properties are proven and
which merely have tests next to them. Each entry therefore carries four fields:

| Field            | Why it is there                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `id`             | Stable, citable from an evidence record                                                                 |
| `invariant`      | The property the variant attacks, so gaps in the set are visible                                        |
| `expected`       | What would go wrong if the defect shipped — the reviewer's check on whether the variant is worth having |
| `test` + `kills` | The exact test that must fail, so a passing sweep names its own evidence                                |

### The outcomes, and why only one of them is evidence

An earlier version of the runner treated **any** non-zero exit as a kill. Measured: pointing the
test database at a closed port reported every variant killed, and a manifest entry naming a test
that does not exist reported it survived. "54/54 killed" was a count of failures of any kind.

Classification now happens in [`../../scripts/mutation-outcome.ts`](../../scripts/mutation-outcome.ts)
over the runner's structured JSON report, and it is a pure function with its own tests against
report fixtures captured from real runs.

| Outcome                 | Meaning                                                                          | Evidence?                                      |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `KILLED_ASSERTION`      | the named test ran and rejected the mutation on an assertion                     | **yes — the only one**                         |
| `KILLED_BY_TIMEOUT`     | the mutation made the code hang, so the named test failed without asserting      | no: a real detection, weaker than an assertion |
| `SURVIVED`              | the named test ran and passed under the mutation                                 | no                                             |
| `BASELINE_FAILED`       | the named test did not pass cleanly on the pristine tree                         | no                                             |
| `NO_TEST_MATCH`         | tests were collected but none matched the filter — a manifest error              | no                                             |
| `INFRA_FAILURE`         | unreachable database, revoked grant, setup failure, or no tests collected at all | no                                             |
| `BUILD_OR_LOAD_FAILURE` | a suite would not transform or load on the pristine tree                         | no                                             |
| `INVALID_MUTANT`        | the mutated source would not transform or load, so the edit is untestable        | no                                             |

Two rules make the count mean something:

1. **A baseline first.** The named test runs against the pristine tree and must actually run and
   pass. Without it, a variant "killed" by an already-red test would be counted as evidence, which
   is how a broken suite launders itself into a perfect score. Baselines are cached per test file
   and filter for the life of one sweep.
2. **The outcome comes from the report, not the exit code.**

A variant may also carry a `note`, for the case where `KILLED_ASSERTION` is impossible _and_
correct: two variants here are rejected by an assertion inside a migration during global setup, so
no suite runs and no test can claim the kill. That is a stronger control than a test, and the report
says so rather than inflating the count.

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

Add an entry to the manifest and run `--validate` first: an anchor that no longer resolves is
reported as `ANCHOR-MISSING`, which is how a refactor that silently orphaned a control is caught.
`NO-TEST-MATCHED` means the `kills` filter names no test, which is a manifest error rather than a
surviving defect.
