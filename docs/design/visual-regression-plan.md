# UX-01 visual regression and screenshot evidence plan

- **Status:** PROPOSED: pending founder acceptance (UX-01 Gate 0). Nothing here is implemented.
- **Governs:** UX-01 gates 2a–5 ([ADR-0025](../adr/0025-frontend-architecture.md) D6).

Screenshots are a tripwire against unintended visual change. They never replace the business assertions of the vertical-slice, packaged-demo and smoke suites, which stay the acceptance evidence.

## 1. Environment (everything fixed)

| Variable          | Fixed value                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application state | the vertical-slice stack (built API and web, PostgreSQL, local Keycloak), as in `playwright.slice.config.ts`, never the founder's packaged demo                              |
| Data              | a fresh database per run, seeded only through the existing simulated-call endpoint with the fixed synthetic set in §3                                                        |
| Browser           | Playwright **1.63.0** Chromium, in the official Playwright container image for that version, pinned by digest when the job is written                                        |
| Fonts             | whatever that image ships; the design uses the system UI stack, and the pinned image makes the resolved fonts deterministic                                                  |
| Locale, timezone  | `locale: 'de-DE'`, `timezoneId: 'Europe/Berlin'`                                                                                                                             |
| Motion            | `reducedMotion: 'reduce'`, `toHaveScreenshot({ animations: 'disabled', caret: 'hide' })`                                                                                     |
| Pointer           | mouse moved to `(0, 0)` before each capture (no hover state)                                                                                                                 |
| Device scale      | 1                                                                                                                                                                            |
| Dynamic values    | masked, not faked: every `<time>`, the page date, and the "Stand HH:MM" line. They are server-rendered from real clocks, so the browser clock can't legitimately freeze them |
| Tolerance         | `maxDiffPixelRatio: 0.01`, `threshold: 0.2` (Playwright defaults otherwise)                                                                                                  |

No production data, no personal data and no real phone numbers are used, ever.

## 2. Regeneration policy

- On CI, `updateSnapshots: 'none'`. A missing or changed baseline **fails** the job, and Playwright's actual and diff images are uploaded as an artifact.
- A failing test never rewrites a baseline. A baseline changes only like this:
  1. a manually triggered workflow regenerates candidates in the same pinned environment and uploads them as an artifact;
  2. a person reviews the before, after and diff images;
  3. the accepted candidates are committed in a PR whose description lists each changed image and why.
- Only Linux baselines are committed (Playwright's platform suffix). Local captures on other systems are for looking, not for committing.

## 3. Synthetic data set

| Card | Title                                      | Priority | Caller (synthetic, E.164) |
| ---- | ------------------------------------------ | -------- | ------------------------- |
| 1    | Rückruf erbeten                            | urgent   | `+493000000101`           |
| 2    | Rückruf: Reservierung                      | normal   | `+493000000102`           |
| 3    | Rückruf: Geburtstagsfeier                  | normal   | `+493000000103`           |
| 4    | Rückruf: Reservierung für Geburtstagsfeier | normal   | `+493000000104`           |

The `+49 30 0000…` numbers aren't valid Berlin subscriber numbers and are used only as synthetic fixtures. How the urgent card is produced is decided in gate 2a from what the simulated-call path actually supports. If it can't produce an urgent task, the Dringend state is captured from a fixture-seeded task through the test helpers already used by the slice suite, and the evidence says so.

A separate long-title case for overflow checks uses a functional assertion, not a screenshot.

## 4. Viewports

| Width × height | Source                       | Screenshots     | Functional checks                                |
| -------------- | ---------------------------- | --------------- | ------------------------------------------------ |
| 320 × 640      | WCAG 1.4.10 reflow           | —               | no horizontal overflow; 72-character title wraps |
| 360 × 740      | PLAN P13.11.02               | —               | overflow, touch targets, axe                     |
| **390 × 844**  | founder's mobile reference   | yes             | overflow, touch targets, axe, keyboard           |
| **768 × 1024** | PLAN P13.11.02 (grid starts) | yes (populated) | overflow, axe                                    |
| 1280 × 800     | PLAN P13.11.02               | —               | overflow, axe                                    |
| **1440 × 900** | desktop                      | yes             | overflow, axe, keyboard, focus visibility        |
| 1920 × 1080    | wide                         | —               | the frame stays at 72rem; no overflow            |

PLAN's 360, 768 and 1280 stay mandatory functional widths. Screenshots go where they carry independent value: mobile, the grid breakpoint, and desktop.

## 5. Baseline matrix: 13 images, reduced from the earlier proposal of 26

| #   | State                                                        | Width(s)       | Capture                                   | Independent value                                        |
| --- | ------------------------------------------------------------ | -------------- | ----------------------------------------- | -------------------------------------------------------- |
| 1–2 | Signed out                                                   | 390, 1440      | full page                                 | the first screen an owner sees; shell and type           |
| 3–4 | Empty (all sections "Alles erledigt.")                       | 390, 1440      | full page                                 | the most common morning state; empty-section rhythm      |
| 5–7 | Populated (§3)                                               | 390, 768, 1440 | full page                                 | the main screen; one-column, grid start, desktop grid    |
| 8   | Loading skeleton                                             | 390            | full page (API response held)             | skeleton layout; nothing else shows it                   |
| 9   | Read failed (API 503)                                        | 1440           | full page                                 | the error alert                                          |
| 10  | Truncated list (101 synthetic tasks, `TODAY_TASK_LIMIT` + 1) | 1440           | full page                                 | proves no counts and the truncation note                 |
| 11  | Action unavailable (legacy contract)                         | 390            | element: the card                         | the degraded card treatment                              |
| 12  | After "Erledigt"                                             | 390            | element: notice plus the Rückrufe section | outcome notice and focus placement                       |
| 13  | Keyboard focus on "Erledigt"                                 | 1440           | element: the card                         | the focus ring, which a regression could silently remove |

**Dropped from the earlier 26:**

- every 1920 image: the frame is capped at 72rem, so it only adds margin; a functional check covers it;
- the 1280 and 360 duplicates of 1440 and 390;
- second widths of the error, truncated and loading states: the same components at the same breakpoints.

## 6. Before evidence

- The capture spec lands **first** (gate 2a) and runs against the main commit before any styling change. That gives the **before** set for the same states, data, viewports and environment.
- The before images are evidence, **not baselines**. They are stored with their SHA-256 in the gate's evidence record, and each after image is paired with its before image by name (`<state>-<width>-before.png` / `-after.png`).
- If a before image could not be captured, for example because a state didn't exist before the redesign, the record says so. That pair is reported as **no comparison**, never as a pass.
- Until gate 2a has run, there is no executable before evidence. The founder's own screenshot of the unstyled app is context, not a comparison baseline.

## 7. Accessibility and functional assertions alongside the screenshots

- axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) shows 0 violations in each state above, at 390 and 1440.
- `scrollWidth <= innerWidth` at every width in §4.
- Every interactive element's bounding box is at least 44 × 44 px.
- Every focus stop has a computed outline width of 3 px or more; the tab order matches [DESIGN.md](DESIGN.md) §7.
- With `reducedMotion: 'reduce'`, every computed transition and animation duration on Heute is 0.
- Under `forcedColors: 'active'`, buttons and focus stay visible (one smoke check).
- The CSP header is present and no `securitypolicyviolation` event fires.
- The existing business assertions pass unchanged. Selectors are only ever added (DESIGN.md §5, preserved contracts).
