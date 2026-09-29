# P03 — Architecture Decisions, Domain Design, Threat Model and Data Inventory · session plan

**Phase:** P03 · **Tier:** PILOT (single tier) · **Target:** 2026-09-29 → 2026-10-06 · **Effort:** 4 engineering-days
**Plan source:** PLAN.md L2176–L2284 · **Dependencies:** P02.03 (repository structure) — **met**

Planned and executed under the founder's standing program authorization. Nothing here changes
product scope, an invariant, a gate, a threshold, a legal or commercial commitment, or introduces
an architecture deviation PLAN does not already carry.

## Why this phase is worth doing carefully

It is almost entirely writing, which makes it easy to under-invest in. But it is where the
expensive-to-change decisions get made explicitly rather than discovered later: tenancy, identity,
the data model, the event model, retention, credentials. Every one of those is cheap to decide now
and costly to reverse after P06–P17 have built on it.

It also produces the two artefacts other people depend on: the **lawyer briefing pack**, which is
what lets the external review start rather than wait, and the **personal-data inventory**, which is
the input to the AVV annexes, the TOMs, DSAR coverage and the retention engine.

## Scope

| Section                                             | Items | Notes                                                                   |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| P03.01 ADR process and core ADRs                    | 5     | 11 accepted, 3 drafted                                                  |
| P03.02 Domain model and glossary                    | 6     | German/English glossary, entities, aggregates, intents, event catalogue |
| P03.03 State machines                               | 4     | Transition tables with property-test plans                              |
| P03.04 C4 and data-flow diagrams                    | 3     | Context + container + DFD with trust boundaries                         |
| P03.05 Threat model v1 (STRIDE)                     | 3     | Includes an independent security review                                 |
| P03.06 Personal-data inventory and retention matrix | 4     | Field-level                                                             |
| P03.07 Lawyer briefing pack `[EXT]`                 | 4     | Engagement is a founder action                                          |
| P03.08 Invariant enforcement register               | 2     | Every INV mapped to an automated check                                  |

## Execution order and why

1. **P03.01 ADRs first.** Everything else references them, and P06 is blocked without ADR-0003,
   0004, 0005 and 0017.
2. **P03.02 and P03.03 together.** The state machines are where the entity model stops being a
   diagram and starts having rules; writing them apart produces two documents that disagree.
3. **P03.06 before P03.04.** The data-flow diagram is only honest if the field-level inventory
   exists first — otherwise the DFD shows the flows someone remembered.
4. **P03.04, then P03.05.** STRIDE is applied per component and per flow, so it needs the diagram.
5. **P03.07 last of the writing.** The briefing pack is assembled from the inventory, the audio
   policy and the drafted ADRs; writing it earlier means writing it twice.
6. **P03.08 throughout, verified at the end.** Each ADR names its enforcement as it is written
   (P03.01.04); the register is the aggregation, and the verification is that no INV is missing one.

## Items, evidence and verification

Evidence IDs continue the registry; the numbers below are indicative, and the registry is
authoritative (allocation is sequential and this phase may interleave with P02's remaining items).

| Item              | Kind       | Verification                                                                                                                                                      |
| ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P03.01.01         | impl       | MADR template + `docs/adr/README.md` index resolving to every ADR file                                                                                            |
| P03.01.02         | impl       | ADR-0001, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0015, 0020 accepted (ADR-0036 is _time, locale and calendars_, owned by P07; see open question Q1)            |
| P03.01.03         | impl       | ADR-0011, 0018, 0019 drafted; 0019 stays `PROPOSED` pending EXT-02                                                                                                |
| P03.01.04         | impl       | Every ADR names the lint rule, CI check, runtime assertion or test that enforces it                                                                               |
| **P03.01.05**     | **verify** | A script cross-checks every INV against the ADR set; no invariant lacks an ADR and no ADR lacks an enforcement                                                    |
| P03.02.01–.05     | impl       | Glossary, entity model, aggregates, canonical intents and outcome codes, event catalogue                                                                          |
| **P03.02.06**     | **verify** | Every entity in the model maps to a blueprint line range; no unmapped entity                                                                                      |
| P03.03.01–.04     | impl       | Transition tables for call session, interaction finalisation, task, lead, appointment request, knowledge item, integration, tenant lifecycle, DSAR, support grant |
| P03.04.01–.02     | impl       | C4 context and container diagrams; DFD with trust boundaries                                                                                                      |
| **P03.04.03**     | **verify** | Every personal-data flow in the DFD maps to a subprocessor entry and an inventory category                                                                        |
| P03.05.01–.02     | impl       | STRIDE per component and flow; abuse cases incl. social engineering and toll-fraud-like traffic                                                                   |
| **P03.05.03**     | **verify** | `security-reviewer` agent + founder, findings tracked                                                                                                             |
| P03.06.01–.03     | impl       | Field-level inventory, retention matrix, data-dictionary generator plan                                                                                           |
| **P03.06.04**     | **verify** | No unclassified column in the MVP tables                                                                                                                          |
| P03.07.01–.02     | impl       | Briefing pack and question list with stage A / stage B deadlines                                                                                                  |
| **P03.07.03–.04** | **[EXT]**  | Engaging counsel is a founder action; records `WAITING_FOR_EXTERNAL`                                                                                              |
| P03.08.01         | impl       | Every INV mapped to lint rule / CI check / runtime assertion / alarm, with an owner                                                                               |
| **P03.08.02**     | **verify** | Every INV has ≥ 1 automated enforcement, or an explicitly documented manual control                                                                               |

## Invariants at risk

This phase writes down the invariants rather than implementing them, so the risk is a different
one: **an ADR that quietly contradicts an INV**, which would then be built on for thirty phases.
P03.01.05 and P03.08.02 exist precisely to catch that, and they are mechanical rather than a
reading — a script cross-references the INV table against the ADR set and the enforcement register.

## Gates

- **QG-10** (documentation) applies throughout; this phase is almost entirely documentation.
- **QG-09** is not triggered by writing, but **P03.05.03 requires an independent security review**
  of the threat model, which is run with the `security-reviewer` agent plus the founder.
- **QG-12** (privacy impact) is not triggered — no personal-data flow is implemented here — but the
  inventory this phase produces is what QG-12 will check against from P06 onward.

## External gates

| ID         | What                                                           | Who                     | Fallback                                                                             |
| ---------- | -------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| **EXT-02** | German data-protection review (the briefing pack is its input) | founder engages counsel | ADR-0019 stays `PROPOSED`; no turn logs by default, which is the conservative branch |
| EXT-03     | Telecom-law questions                                          | via counsel             | folded into EXT-02's pack                                                            |
| EXT-04     | AI Act role questions                                          | via counsel             | folded into EXT-02's pack                                                            |
| EXT-05     | Emergency and allergen script review                           | via counsel             | the deterministic script stays unreviewed and the capability stays off (INV-13)      |

P03.07.03/.04 record `WAITING_FOR_EXTERNAL` with counterparty, request date, expected date and
fallback. **No ADR that depends on legal input is marked accepted on this session's judgement.**

## PR sequence

Short-lived branches, drafts, squash-merged by the founder.

| #   | Branch                           | Sections                       |
| --- | -------------------------------- | ------------------------------ |
| 1   | `docs/p03-01-adrs`               | P03.01                         |
| 2   | `docs/p03-02-domain-model`       | P03.02, P03.03                 |
| 3   | `docs/p03-06-data-inventory`     | P03.06                         |
| 4   | `docs/p03-04-diagrams`           | P03.04                         |
| 5   | `docs/p03-05-threat-model`       | P03.05                         |
| 6   | `docs/p03-07-legal-pack`         | P03.07 (engagement stays open) |
| 7   | `docs/p03-08-invariant-register` | P03.08                         |

## Open questions

**Q1 — ADR-0036.** PLAN's _Architecture decisions_ line for P03 says to accept "ADR-0001, 0003,
0004, 0005, 0006, 0007, 0008, 0009, 0015, 0020 and **0036**", but the ADR register assigns
ADR-0036 to _time, locale and calendars_ in **P07**. Those disagree. Read as written, P03 would
accept a P07 decision before the code that motivates it exists.

I am proceeding on the reading that **ADR-0036 belongs to P07** (the register is the more specific
statement, and the phase column is unambiguous), and P03 accepts the other ten. If the founder
reads it the other way, ADR-0036 is a small, self-contained addition to P03.01.02.

Noted alongside: P02 originally wrote its two local-emulator decisions as ADR-0035 and ADR-0036,
colliding with reserved numbers. They are now **ADR-0044** and **ADR-0045** and are in the register.

**Q2 — ADR-0019 (turn logs).** PLAN marks it "final only after EXT-02". It will be written and
left `PROPOSED`, with the default branch (no transcripts, no turn logs) described as the position
that holds if counsel never answers. That is the conservative reading of INV-07 and is not a
decision this session takes.
