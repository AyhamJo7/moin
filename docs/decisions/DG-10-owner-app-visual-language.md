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

**Layout (provisional):** the founder selected the work-queue layout (Direction B) on 2026-10-20 as the preferred direction: one panel per section, one row per task in the API's order, and an outlined "Erledigt". The selection is subject to the owner usability test below. In particular, criterion C5 of the [test plan](../design/owner-usability-test.md) requires that owners find "Erledigt" without prompting.

Tokens, components and states are specified in [DESIGN.md](../design/DESIGN.md).

## Status and what remains open

Three things are kept apart:

|     | What                                                                                   | State                                                                                                                    |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A   | The founder provisionally chooses the direction                                        | done (provisional, UX-01 Gate 0)                                                                                         |
| B   | The founder accepts this record, ADR-0025 and DESIGN.md as planning guidance for UX-01 | pending founder review of the Gate 0 PR                                                                                  |
| C   | DG-10's PLAN evidence exists: an owner usability test, recorded as an evidence record  | **NOT_STARTED**: no owner test has taken place; the plan is [owner-usability-test.md](../design/owner-usability-test.md) |

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

## Recorded founder decisions

### 2026-10-20: an interactive prototype for the owner test (preparatory exception)

- **Decision (founder, recorded from the founder's instruction):** "The founder authorizes ONLY the creation of a small, isolated, synthetic interactive prototype necessary to gather DG-10 owner usability evidence … This is not authorization for general UX-01 or P13.01 implementation."
- **Authority:**
  - This answers the question decision 1 leaves to the founder ("what it runs on"). It follows path (a): the test comes before DG-10 is taken.
  - It needs **no PLAN amendment**. PLAN requires a change-log entry and founder approval only for changes to phases, gates or thresholds ("How to Use This Plan"). This changes none:
    - DG-10 still requires the owner usability test and still blocks P13.01;
    - the prototype produces DG-10's own evidence and delivers no P13.01 item.
- **Scope:** only [docs/design/owner-test/](../design/owner-test/README.md):
  - a static in-browser simulation of Heute in the work-queue layout, with synthetic data (the four canonical titles and the `+49 30 0000…` fixtures);
  - its moderator page, its checks and the session material.
- **Limits:**
  - **Outside the product:** nothing outside the pnpm workspace, the release image and its build context (`docs` is in `.dockerignore`). No file in `apps/`, `packages/`, `infrastructure/`, migrations, CI or deployment configuration is added or changed.
  - **No server, no application connections:**
    - **Delivery:** the prototype is opened from local files (`file://`) on the moderator's computer. No server is run.
    - **CSP:** the page's `connect-src 'none'` blocks its own programmatic connections (fetch, XHR, WebSocket, beacon). It doesn't govern loading the page's own files, following its links, or handing a `tel:` link to the phone app.
    - **Also excluded:** accounts, real customer data, external assets, analytics and telemetry. It is never deployed publicly.
    - **Correction note (2026-10-20, after independent review):** the first wording ("no network request") overstated what the CSP does. The boundary itself, no server, is unchanged.
  - **Not a code source:** no prototype code may be copied into `apps/web` or `packages/ui`; the implementation is built under ADR-0025.
  - **What a result proves:** usability of the design only. It is not P13 acceptance and proves nothing about persistence, authentication, live updates or recovery.
- **Expiry:** the exception ends when DG-10 is decided (TAKEN, changed or rejected) or on 2026-12-31, whichever comes first. The prototype is then removed in a docs PR; evidence keeps the commit SHA it was tested at.
- **Unchanged:** DG-10 stays **PROVISIONAL**. Item C (evidence complete) stays NOT_STARTED until an owner session has actually taken place and been recorded. P13.01 stays blocked.

### Proposed amendment: phone access over the local network (**NOT AUTHORIZED**)

**Status:** a proposal for the founder's decision. It is **not authorised**, and no part of it may be carried out until the founder records approval here, with the date and the approved values. Until then, the owner test can't run on a phone. Phone tasks (T3, T5 on the phone, T6, T7, T10) and criterion C5's phone half stay "nicht getestet", so DG-10's evidence can't be complete.

**Why it is needed:** a participant's phone can't open files on the moderator's computer. Serving the prototype to a phone means running an HTTP server, which the recorded exception excludes.

**What an approval would allow, and nothing more:**

1. **What is served:** only the versioned synthetic prototype at a named commit: a copy of `docs/design/owner-test/prototype/` and `docs/design/review/mockups/proposal.css`, read-only. Nothing else from the repository is in the served directory.
2. **Where:** bound to one founder-approved LAN interface address in one approved subnet. Not a wildcard bind on all interfaces, which is not equivalent and isn't approved by this proposal.
3. **Port:** one temporary, predetermined port, open only for the session.
4. **No public routing:** no router port forwarding, tunnel or other internet exposure.
5. **No product services:** no production API, Keycloak, database or other application service is reachable through it. The prototype references none, and its CSP blocks programmatic connections.
6. **No telemetry:** no application telemetry, analytics or external assets.
7. **Lifecycle:** started immediately before the session and stopped immediately after, by the moderator. Its start and stop times go on the observation sheet.
8. **Access logs:**
   - access logging disabled where the server allows it;
   - otherwise the log goes to a temporary file that is deleted after the session;
   - the phone's local-network address and the requested paths are treated as personal data of the participant;
   - the consent text says so.
9. **Preflight:** a phone connectivity check with the moderator's own phone before the participant arrives.
10. **Nothing persisted:** no credentials, accounts or caller data, and nothing stored on the server.

**WSL2:** a server inside WSL2 sits behind NAT and isn't reachable from the LAN by default. Making it reachable (port proxying, firewall rules) is a separate change to the founder's machine and needs its own approval; this proposal doesn't include it. The founder chooses one of:

- **(a)** a server on the Windows host bound to the approved interface;
- **(b)** a separate computer;
- **(c)** an isolated network for the session, such as a dedicated hotspot, so that only the moderator's devices and the participant's phone share it.

**Values the founder must fill in to approve:** the interface address and subnet, the port, the serving machine, the logging treatment, the retention of any log, and the session dates the approval covers.

## Options considered

| Option                                                   | Why not                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| iQuantum dark editorial style                            | DG-10 reserves it for marketing; dark, high-motion and editorial suit a showcase, not a work surface used between customers |
| Warm accent hue (terracotta, amber) on actions or chrome | collides with the warning and urgent semantics, and is a widely recognised generated-design cliché                          |
| Cool neutral greys                                       | acceptable, but colder than the restrained warmth the founder asked for                                                     |
| A web font (for example, Inter)                          | needs OFL-1.1 on the licence allowlist (loosening a gate) and build-time font handling; not needed for clarity              |
