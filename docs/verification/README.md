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
