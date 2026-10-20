# DG-10 — Owner-app visual language

- **Gate:** PLAN Founder Decision Gates, DG-10. **Owner:** founder. **Target date:** 2026-10-12 (overdue).
- **Decision:** **PROVISIONAL, not TAKEN.** The founder has provisionally selected the direction below (UX-01 Gate 0). Accepting this record, [ADR-0025](../adr/0025-frontend-architecture.md) and [DESIGN.md](../design/DESIGN.md) as planning guidance does not make it TAKEN. PLAN's evidence for DG-10, an owner usability test, has not taken place (see [Status and what remains open](#status-and-what-remains-open)).
- **Blocks (PLAN L507):** P13.01, including P13.01.04 (design tokens) and the styling work of UX-01 gates 2–5.
- **Unblocks on:** a founder decision on how the owner usability test is sequenced, then DG-10 TAKEN on that basis. Merging the PR that adds this record changes nothing about DG-10's state.

## The question

Which visual language does the owner app use?

**PLAN's recommended default:** "Calm, light-default, high-contrast operational UI for the owner app; iQuantum style only for marketing if KlarDesk is an iQuantum brand."

## Provisional decision

A **calm, premium, light, high-contrast operational SaaS design** for German restaurant owners and small-business operators.

**It prioritises:**

- clarity, readability and trust;
- finding work fast, with clear primary actions;
- a professional visual hierarchy;
- accessible interaction states;
- responsive operation from 320 px to wide desktop.

**Visual elements:**

| Element        | Choice                                                                               |
| -------------- | ------------------------------------------------------------------------------------ |
| Grounds        | warm-neutral background `#F6F5F2` and white surfaces; warm-neutral text greys        |
| Action colour  | accessible blue `#1D5FA8` (6.5:1 on white; hover `#174C86`, pressed `#123D6C`)       |
| Status colours | urgent, success and warning, each with its own background, always paired with text   |
| Accent         | **no decorative terracotta or warm accent** at this stage                            |
| Type           | the system UI font stack; no web font, no font-licence change in this milestone      |
| Mode           | light only; dark mode deferred ([ADR-0025](../adr/0025-frontend-architecture.md) D4) |

**Excluded:**

- glassmorphism, gradients and decorative shadows;
- animation beyond feedback;
- generic or generated imagery;
- decorative analytics, KPI tiles or invented statistics;
- dashboard complexity the product doesn't have.

**Content rules:** no screen invents business data. In particular there is no completed-task history, no "automatisch erledigt" counts and no error correlation ids until the backend supplies them. Counts never pose as total workload when the list is truncated. Nothing claims a real telephony connection. The Keycloak sign-in theme is out of scope.

Tokens, components and states are specified in [DESIGN.md](../design/DESIGN.md).

## Status and what remains open

Three things are kept apart:

|     | What                                                                                   | State                                          |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A   | The founder provisionally chooses the direction                                        | done (provisional, UX-01 Gate 0)               |
| B   | The founder accepts this record, ADR-0025 and DESIGN.md as planning guidance for UX-01 | pending founder review of the Gate 0 PR        |
| C   | DG-10's PLAN evidence exists: an owner usability test, recorded as an evidence record  | **NOT_STARTED**: no owner test has taken place |

A and B don't imply C. Viewing the mock-ups, whether by the founder or anyone else, is not an owner usability test. This record contains no usability observations.

**What PLAN says, and what it leaves open.**

- The DG-10 row: evidence required "Owner usability test"; blocks P13.01 (L507). P13 lists DG-10 among its dependencies.
- P13's acceptance criteria include a separate session: "Owner usability session with the Gurlitt owner: they complete the morning review of 10 synthetic items in < 5 minutes without help". P13's required evidence names "usability session notes".
- PLAN doesn't say what the DG-10 test consists of, or whether it may run on a prototype. It doesn't say whether it may be the same session as P13's, or whether DG-10 may be taken on its recommended default before the test.
- PLAN gives the notes the ID EV-P13-003, but `evidence.py` has already allocated EV-P13-003 to an unrelated record (cards-shapes). The notes get the next free P13 ID when the session takes place.

**Until the founder decides:** DG-10 stays PROVISIONAL, and P13.01 implementation, including the tokens and UX-01 styling, stays blocked as PLAN says. Neither ADR-0025 nor DESIGN.md is a way around that.

## Founder decisions

1. **How DG-10's evidence is produced.** Either:
   - **(a) PLAN as written:** an owner usability test before DG-10 is taken. The founder also decides what it runs on. Building a styled Heute for the test is P13.01 work and would need the founder's explicit permission.
   - **(b) A PLAN change.** It loosens a gate, so only the founder can make it: take DG-10 on the recommended default now and record the owner test as follow-up evidence on the implemented Heute, with a named trigger for revising the language if the test fails.
2. Whether the DG-10 test and P13's acceptance session may be one session.
3. Whether work that doesn't style the app may proceed while DG-10 is open: the gate 2a before-capture spec ([visual-regression-plan.md](../design/visual-regression-plan.md) §6) and the refresh-health gate RH ([DESIGN.md](../design/DESIGN.md) §6.1, P13.10.02). The M2B polling (P13.02.04) landed while DG-10 was open, but PLAN lists DG-10 as a dependency of all of P13.
4. That P13.10.02's "2 min without updates" means "without a successful refresh", not "without new tasks" (DESIGN.md §6.1).

## Options considered

| Option                                                   | Why not                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| iQuantum dark editorial style                            | DG-10 reserves it for marketing; dark, high-motion and editorial suit a showcase, not a work surface used between customers |
| Warm accent hue (terracotta, amber) on actions or chrome | collides with the warning and urgent semantics, and is a widely recognised generated-design cliché                          |
| Cool neutral greys                                       | acceptable, but colder than the restrained warmth the founder asked for                                                     |
| A web font (for example, Inter)                          | needs OFL-1.1 on the licence allowlist (loosening a gate) and build-time font handling; not needed for clarity              |
