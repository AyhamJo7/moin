# EV-P02-030: German-realistic synthetic factories, seeded and reserved-range only (INV-16)

| Field | Value |
|---|---|
| Evidence ID | EV-P02-030 |
| Item | P02.05.03 |
| Date (UTC) | 2026-09-28 16:33 UTC |
| Commit | `6f79b0ec3c236853dc3021d5ad9a4eab7ae9612a` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | packages/testing/src/factories/german.ts: a seeded xorshift32 source so a failing test is reproducible from its seed rather than appearing once in fifty runs; names with umlauts and ss; streets, cities and real PLZ including ones with a leading zero; mobile numbers in +49157######## and landlines in +49321########, both inside Bundesnetzagentur test ranges; email on .example, reserved by RFC 2606 and unroutable. 7 tests: determinism from a seed; different seeds differ; 500 generated numbers all inside the reserved ranges; 200 emails all unroutable; leading zeros preserved in PLZ; names containing umlauts or ss are produced; and character folding. |
| Result | PASS — 7/7, and the folding test found a real bug. Turkish dotless i has no combining mark, so NFD left it intact and the ASCII strip deleted it outright: "Yilmaz" folded to "ylmaz". Turkish surnames are common in Germany and the result looks plausible while matching nothing. Folding is now an explicit table covering the German convention (ue not u, ss not nothing) and the letters NFD cannot decompose. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
