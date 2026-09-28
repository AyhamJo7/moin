# EV-P03-018: Data-flow diagram with five trust boundaries and twelve classified flows

| Field | Value |
|---|---|
| Evidence ID | EV-P03-018 |
| Item | P03.04.02 |
| Date (UTC) | 2026-09-28 23:16 UTC |
| Commit | `b9f29969dc70690009fb41b4b18b001b64166a1d` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/architecture/data-flow.md draws five trust boundaries (public internet, provider, our perimeter, application, data) and twelve numbered flows, each with the personal data it carries, its inventory category and the guard at the crossing. Three crossings are discussed rather than tabulated: F3, utterance text to a model provider, which is the flow a data-protection review will look at hardest and is bounded by sending no identifiers with it, an EU project with no-training headers, and not persisting what comes back beyond template-defined facts, so the corpus that would make it worrying never accumulates on our side; F2, audio in transit, never written, stated as a DESIGN property — there is no configuration that turns recording on (INV-07); and F10, notifications, which carry a template id and an identifier rather than the caller request, because the tempting design would put personal data through Apple, Google and an SMS carrier onto a device that may not be the owner. |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
