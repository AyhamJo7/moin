# DG-10 — Owner-app visual language

- **Gate:** PLAN Founder Decision Gates, DG-10. **Owner:** founder. **Target date:** 2026-10-12 (overdue).
- **Decision:** **PROVISIONAL, pending founder acceptance.** The founder has provisionally selected the direction below (UX-01 Gate 0). It becomes TAKEN when the founder accepts this record after reviewing it and [DESIGN.md](../design/DESIGN.md).
- **Blocks:** P13.01.04 (design tokens) and UX-01 implementation gates 2–5.
- **Unblocks on:** founder acceptance of this record, [ADR-0025](../adr/0025-frontend-architecture.md) and DESIGN.md.

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

## Evidence required by PLAN

The DG-10 row asks for an owner usability test. This record fixes the language. Verifying it with an owner is P13 evidence (EV-P13-003, usability session notes) on the implemented Heute (UX-01 gate 3 or later), not on mock-ups.

## Options considered

| Option                                                   | Why not                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| iQuantum dark editorial style                            | DG-10 reserves it for marketing; dark, high-motion and editorial suit a showcase, not a work surface used between customers |
| Warm accent hue (terracotta, amber) on actions or chrome | collides with the warning and urgent semantics, and is a widely recognised generated-design cliché                          |
| Cool neutral greys                                       | acceptable, but colder than the restrained warmth the founder asked for                                                     |
| A web font (for example, Inter)                          | needs OFL-1.1 on the licence allowlist (loosening a gate) and build-time font handling; not needed for clarity              |
