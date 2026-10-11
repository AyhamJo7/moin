# Audit mutation sweep — 2/2 KILLED_ASSERTION

Only `KILLED_ASSERTION` is evidence: the named test ran on the pristine tree, passed, then ran
against the mutated source and rejected it on an assertion. Every other outcome is reported as
itself rather than folded into a kill count.

Measured against HEAD `49e15a548cee3dd45566d5a8f57e7ef66e4695ee`, with every mutation target proved equal to its HEAD blob before
the sweep, after every variant, and on every restore.

- **KILLED_ASSERTION:** 2

| Variant                                 | Invariant targeted                                                                     | Expected failure if it shipped                                                                    | Source                                                    | Killing test                                                                                                                        | Baseline | Outcome              | Detail                                                                                                                       | Baseline / mutant |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `M1-view-conflict-exclusion-removed`    | Approved-only retrieval: conflicted items are never retrievable (P09.09.01, P09.09.05) | A conflicted item would appear in knowledge_approved_current, so readApprovedVersions returns it. | `packages/db/migrations/0060_approved_retrieval_view.sql` | `packages/db/src/retrieval.integration.test.ts` — “retrieval-exclusion > expired, suspended and conflicted never retrievable”       | passed   | **KILLED_ASSERTION** | the intended test ran and rejected the mutation on a trusted matcher failure (the terminal value is the object assert threw) | 2s / 2.1s         |
| `M2-catalogue-active-exclusion-removed` | Closed-set catalogue: deactivated cards leave the catalogue (P09.09.02, P09.09.05)     | A deactivated card would remain in listCardCatalogue, so the NLU could select it.                 | `packages/db/src/retrieval.ts`                            | `packages/db/src/retrieval.integration.test.ts` — “retrieval-exclusion > deactivated cards leave catalogue, candidates and answers” | passed   | **KILLED_ASSERTION** | the intended test ran and rejected the mutation on a trusted matcher failure (the terminal value is the object assert threw) | 1.9s / 2s         |
