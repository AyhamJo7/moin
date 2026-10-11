# Audit mutation sweep — 1/1 KILLED_ASSERTION

Only `KILLED_ASSERTION` is evidence: the named test ran on the pristine tree, passed, then ran
against the mutated source and rejected it on an assertion. Every other outcome is reported as
itself rather than folded into a kill count.

Measured against HEAD `b2db61d3de36b430bfc9bf72a38f6b2d900a145e`, with every mutation target proved equal to its HEAD blob before
the sweep, after every variant, and on every restore.

- **KILLED_ASSERTION:** 1

| Variant                            | Invariant targeted                                                    | Expected failure if it shipped                                                                                                                       | Source                            | Killing test                                                                                        | Baseline | Outcome              | Detail                                                                                                                              | Baseline / mutant |
| ---------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | -------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `M1-private-address-check-removed` | SSRF guard: no private address is ever dialled (P09.08.02, P09.08.05) | A hostname resolving to a private address (rebinding second address, literal private IP, rebinding robots host) would be fetched instead of refused. | `packages/db/src/import-fetch.ts` | `packages/db/src/import.integration.test.ts` — “import-ssrf > dns-rebinding second address refused” | passed   | **KILLED_ASSERTION** | the intended test ran and rejected the mutation on a trusted matcher failure (the terminal value is the object toMatchObject threw) | 2s / 2s           |
