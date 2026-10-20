# Owner app design system (DESIGN.md)

- **Status:** PROPOSED: pending founder acceptance (UX-01 Gate 0). Not binding until the founder accepts it, and nothing here is implemented yet.
- **What acceptance means:** founder acceptance makes this file planning guidance for UX-01. It does **not** complete DG-10, whose PLAN evidence (an owner usability test) is still outstanding, and it does not by itself unblock P13.01 implementation. See [DG-10](../decisions/DG-10-owner-app-visual-language.md), "Status and what remains open".
- **Scope:** the owner web app (`apps/web`) and its shared components (`packages/ui`). It does not cover marketing pages or the Keycloak sign-in theme.
- **Decided with:** [DG-10](../decisions/DG-10-owner-app-visual-language.md) (visual language) and [ADR-0025](../adr/0025-frontend-architecture.md) (frontend architecture).
- **Layout:** **Direction B, the work queue** (one panel per section, one row per task), selected by the founder on 2026-10-20 as the preferred direction. The selection is provisional: it is subject to the owner usability test that DG-10 requires ([owner test plan](owner-usability-test.md)). The alternative card layout (Direction A) was explored and not adopted.
- **Review package:** [review/README.md](review/README.md) (proposal mock-ups, not screenshots of the app).

## 0. Authority

When sources disagree, the higher one wins:

1. PLAN, the invariants (INV-01…INV-20), security, accessibility (WCAG 2.2 AA, P13.12) and repository governance.
2. The DG-10 decision, once taken with its PLAN evidence ([record](../decisions/DG-10-owner-app-visual-language.md)).
3. The adopted ADR-0025.
4. This file, once approved.
5. Suggestions from external design skills, references and tools. They are advisory only and never override 1–4 ([design-references.md](design-references.md)).

## 1. Character

The owner app is the owner's order book, used between two customers, often on a phone. Every screen answers four questions in this order:

1. Does anything need me now?
2. Who wants a callback, and why?
3. What can I safely do right here?
4. Is what I'm seeing current?

**Calm, premium, light and high-contrast.**

- **Premium** comes from precision: consistent alignment, one type scale, generous but disciplined spacing, and quiet surfaces. It does not come from decoration.
- **Warmth** comes from the warm-neutral greys of the background and surfaces and from plain German copy. There is no decorative warm accent colour (DG-10).

**Not:**

- a developer diagnostics console: no monospace, no raw ids, no JSON-like labels;
- a marketing page: no hero, gradients, glass, illustrations or generic stock or AI imagery;
- an analytics dashboard: no KPI tiles, charts or trend arrows;
- a copy of any other company's brand.

## 2. Content rules (binding)

- **No invented business data.** Every number, status and time on screen comes from the API response or from the browser's own verifiable state, such as the time of its last successful read. The following stay out until the backend supplies them: completed-task history, "automatisch erledigt" counts, error correlation ids, trends, percentages, customer statistics and claims about real telephony.
- **A count never poses as total workload.**
  - A section shows its count only when the API returns `truncated: false`. Then the count equals the number of tasks rendered.
  - When the list is truncated, no section shows a count, and the existing truncation note (`today.truncated`) explains that not all tasks are shown.
- **No status is shown by colour alone.** Every status has its German word; colour and icon only reinforce it.
- **German first.**
  - All copy comes from `apps/web/messages/de.json` through `t()`.
  - Sentence case and the "Sie" form.
  - No AI jargon (BR-060).
  - Verbs name the result ("Erledigt", "Neu laden").
- **Long German text wraps, it isn't cut.**
  - Text uses `overflow-wrap: break-word` with `hyphens: auto` (the document is `lang="de"`).
  - Phone numbers and times use `white-space: nowrap`; they are short.
  - A task title of up to 72 characters (`TASK_TITLE_MAX_LENGTH`) wraps without overflow at 320 CSS px.
- **Personal data:** the caller number appears only in its task row and as its `tel:` link. It never goes in the page title, the URL, a notice or a log.

## 3. Tokens

All values are CSS custom properties declared once in `packages/ui/src/tokens.css` inside Tailwind's `@theme` (ADR-0025 D2). Components reference tokens only; a raw colour value in a component fails review.

### 3.1 Colour (light mode)

Contrast follows WCAG 2.x relative luminance. "Surface" is `#FFFFFF`, "canvas" is the page background. A ratio of 4.5:1 or more is required for text and 3:1 or more for control boundaries and focus indicators.

| Token                     | Value     | Role                                                              | Contrast                                               |
| ------------------------- | --------- | ----------------------------------------------------------------- | ------------------------------------------------------ |
| `--color-canvas`          | `#F6F5F2` | page background (warm neutral)                                    | —                                                      |
| `--color-surface`         | `#FFFFFF` | section panels                                                    | —                                                      |
| `--color-surface-sunken`  | `#EFEDE9` | status chips, skeletons, hover of secondary controls              | —                                                      |
| `--color-text`            | `#1C1B19` | running text, headings                                            | 17.2 on surface · 15.8 on canvas · 14.7 on sunken      |
| `--color-text-muted`      | `#57534E` | labels, times, secondary lines                                    | 7.6 on surface · 7.0 on canvas · 6.5 on sunken         |
| `--color-border`          | `#DDD9D2` | panel outline, row and header rules (decorative)                  | 1.3–1.4 (not a control boundary)                       |
| `--color-border-control`  | `#8A847C` | secondary-button outline                                          | 3.7 on surface · 3.4 on canvas · 3.2 on sunken (hover) |
| `--color-primary`         | `#1D5FA8` | "Erledigt" text and outline, call links, primary fill, focus ring | 6.5 on surface · 5.9 on canvas · 5.7 on info-bg        |
| `--color-primary-hover`   | `#174C86` | hover fill, hovered link and outline text                         | 8.7 (white on it) · 8.7 on surface · 7.7 on info-bg    |
| `--color-primary-pressed` | `#123D6C` | pressed fill (also of the outlined action)                        | 11.0 (white on it)                                     |
| `--color-on-primary`      | `#FFFFFF` | text and icons on primary fills                                   | 6.5 / 8.7 / 11.0 by state                              |
| `--color-info-bg`         | `#EAF1FA` | hover ground of the outlined action and of call links             | primary 5.7 · primary-hover 7.7 on it                  |
| `--color-urgent`          | `#B42318` | Dringend text, icon and row bar                                   | 6.6 on surface                                         |
| `--color-urgent-bg`       | `#FDF1EF` | Dringend badge ground                                             | urgent text on it 6.0                                  |
| `--color-success`         | `#1E6B3A` | confirmed outcome                                                 | 5.9 on its background                                  |
| `--color-success-bg`      | `#EDF6EF` | outcome notice ground                                             | —                                                      |
| `--color-warning`         | `#8A5300` | stale, degraded, "nicht möglich"                                  | 5.8 on its background                                  |
| `--color-warning-bg`      | `#FDF5E4` | error and degraded alert ground                                   | —                                                      |

**Interaction states.**

- **Blue means "you can act here".** It marks "Erledigt", call links, the active navigation entry and the focus ring. Statuses are neutral, and only "Dringend" carries a colour.
- **Outlined action** (`Button` variant `outline`; "Erledigt"): white ground with a 1.5 px `primary` outline and `primary` text (6.5) → hover `info-bg` ground with `primary-hover` text and outline (7.7) → pressed `primary-pressed` fill with white text (11.0). A long queue therefore shows no column of filled blocks. **This is provisional:** the owner usability test must show that owners find "Erledigt" without prompting. Otherwise the fallback is the filled `primary` variant in the same place, a one-variant change ([owner test](owner-usability-test.md), criterion C5).
- **Primary button** (filled; "Anmelden"): `primary` → hover `primary-hover` → pressed `primary-pressed`, with white text at 6.5, 8.7 and 11.0.
- **Call link:** the caller number is a link, not a button: `primary` text, a 1 px underline offset 4 px, the phone icon, and a 44 px tall hit area. Hover adds an `info-bg` ground.
- **Focus:** the ring is `--color-primary`, 3 px, offset 2 px. It always sits on the surface or canvas behind the control (5.9 or more), never on the button's own fill.
- **Pending:** a pending action keeps full-contrast text ("Wird gespeichert …") with `aria-busy`. The interface has no low-contrast greyed-out "disabled" style.

### 3.2 Status semantics

| Meaning                          | Visual                                                                                    | Text (from `de.json`)                             |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Needs attention now (`urgent`)   | urgent chip with icon plus a 4 px urgent bar on the row; an icon before the panel heading | chip "Dringend"; section heading "Dringend"       |
| Open                             | neutral chip: muted text on sunken background (6.5)                                       | "Offen"                                           |
| In progress or waiting           | muted text on sunken background                                                           | "In Bearbeitung", "Wartet"                        |
| Outcome confirmed by the API     | success notice with a check icon                                                          | `today.complete.done`                             |
| Read failed, stale, not possible | warning alert with an icon                                                                | `today.error`, `today.complete.unavailable`, §6.1 |

Icons come from `lucide-react` and are `aria-hidden="true"`, because their meaning is always also in the text.

### 3.3 Typography

- **Family:** the system UI stack, `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`. There are no web fonts and no font licence change.
- **Numbers:** `font-variant-numeric: tabular-nums` for times and phone numbers.
- **Never:** all-caps labels, letter-spaced eyebrows, italics for emphasis, or a second family.
- **Zoom:** at 200% text zoom (WCAG 1.4.4) nothing is clipped. At 320 CSS px (WCAG 1.4.10) the page reflows to one column without horizontal scrolling.

| Role          | Size (rem / px)                    | Line height | Weight |
| ------------- | ---------------------------------- | ----------- | ------ |
| Caption       | 0.8125 / 13                        | 1.4         | 400    |
| Small         | 0.9375 / 15                        | 1.45        | 400    |
| Body          | 1 / 16                             | 1.5         | 400    |
| Task title    | 1 / 16                             | 1.35        | 600    |
| Section title | 1.125 / 18                         | 1.3         | 600    |
| Page title    | 1.625 / 26, from 768 px 1.875 / 30 | 1.2         | 650    |

### 3.4 Space, borders, radius and elevation

| Token         | Value                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 · 48 px                                                                                                               |
| Page gutter   | 16 px below 768 px · 24 px from 768 · 32 px from 1280                                                                                           |
| Content frame | max 72rem (1152 px), centred; content left-aligned                                                                                              |
| Row padding   | 16 px sides (phone) · 20 px from 768 px; desktop rows at least 56 px tall                                                                       |
| Gaps          | 20 px between section panels; rows divided by 1 px `--color-border`, no gap                                                                     |
| Touch target  | 44 × 44 px or more, at least 8 px apart                                                                                                         |
| Borders       | 1 px `--color-border` on panels, rows and the header; secondary controls `--color-border-control`; the outlined action 1.5 px `--color-primary` |
| Radius        | 6 px controls · 10 px panels (square and edge to edge below 768 px) · full for chips                                                            |
| Elevation     | none at rest; one soft shadow is reserved for future floating layers                                                                            |
| Focus         | `outline: 3px solid var(--color-primary); outline-offset: 2px` on `:focus-visible`                                                              |

### 3.5 Motion

Motion is feedback only:

- the press state, which is immediate;
- the outcome notice fading in (opacity, 150 ms, ease-out);
- the skeleton tint, which is static under reduced motion.

There are no entrance animations, staggered reveals, hover scaling, scroll effects, animated counters or pulsing "live" dots. Keyboard-initiated actions are never animated. Under `prefers-reduced-motion: reduce` every transition and animation duration is 0.

## 4. Layout

**Application shell.**

- A top bar on the canvas ground, 56 px tall, divided from the page by one 1 px rule, holds the product name and the navigation.
  - The name comes from `NEXT_PUBLIC_BRAND_NAME`, never a literal (ADR-0034).
  - Today the only navigation entry is "Heute". The other BR-060 areas appear only when they ship. "Abmelden" comes with the logout flow (P13.01.01).
- The active entry is marked by `aria-current="page"`, weight 600 and a 2 px primary underline, not by colour alone.
- The skip link "Zum Inhalt springen" stays first in tab order.

**Page header.**

- The h1 is "Heute", followed by the date in German long form.
- The status line reads "Stand HH:MM", the time of the last successful read of the task list as observed by this page: the server's read for the first render, then every successful poll, **including one whose answer is unchanged and causes no re-render** (§6.1). It is never a backend freshness timestamp. Today's page has no status line; it arrives with the refresh-health gate (§6.1).
- "Aktualisieren" stays a **link** styled as a secondary button.

**Sections: one panel each.**

- Sections appear in PLAN order: Dringend · Rückrufe · Neue Anfragen · Termine/Reservierungen zu bestätigen · Offene Kundenfragen.
- A section with tasks is a white panel: a header (h2, the count, and the alert icon for Dringend), the column labels, then one row per task.
- The `<section>` stays labelled by its heading text alone (`aria-labelledby` on the heading's text element). Its accessible name therefore stays exactly "Rückrufe" etc.
- The count (§2) is a separate element next to it, outside that label.
- **Empty sections** keep their place in PLAN order. Consecutive empty sections share one quiet panel, one row each: the h2 and "Alles erledigt." in muted text with a check icon. Each is still its own `<section>` named by its heading.

**Rows: one column of tasks in the API's order.**

- The order is exactly the API's (urgent first, then newest), read top to bottom. There is never a multi-column grid of tasks, because a time-ordered list read across columns zigzags.
- **From 1100 px:** one line per task in fixed columns: Aufgabe (flexible) · Status 6.5rem · Anrufer 12.5rem · Eingegangen 10.5rem · action 9.5rem, with 24 px between columns. Rows are at least 56 px tall.
- **Column labels** ("Aufgabe", "Status", "Anrufer", "Eingegangen") are a visual aid only (`aria-hidden="true"`). Each cell carries its own `<dt>`, so assistive technology gets the facts from the row itself.
- **768–1099 px:** two lines. The title is on the first, the status and the receipt time on the second, and the call link and action sit at the right of both.
- **Below 768 px:** a full-width block per task. The panels run edge to edge with square corners. The title is on the first line, the status and the receipt time on the second, and the call link (left) and "Erledigt" (right) on the third.
- No column, row or control has a fixed height that clips text. Long titles wrap; chips, numbers and times don't.

**Wide screens.** The frame stays at 72rem. There are no stretched text lines and no side panels with invented content.

## 5. Components (`@moin/ui`)

| Component        | Contract                                                                                                             | Rendering   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| `AppShell`       | skip link, top bar, navigation, `<main id="inhalt">`                                                                 | server      |
| `PageHeader`     | h1, date, a status-line slot, an actions slot                                                                        | server      |
| `SectionPanel`   | `<section aria-labelledby>`: h2, an optional count element, column labels, the task list                             | server      |
| `QuietSections`  | one panel holding consecutive empty sections, each its own `<section>` with h2 and empty line                        | server      |
| `TaskRow`        | `<li><article aria-labelledby>`: h3 title, then one `<dl>` per cell (status, caller, received), then the action slot | server      |
| `StatusBadge`    | text plus tone from a status value; the text is always rendered                                                      | server      |
| `Button`         | variants `outline`, `primary`, `secondary`; renders `<button>` or `<a>`                                              | server-safe |
| `Alert`          | tones `info`, `warning`, `urgent`; the caller passes the `role`                                                      | server      |
| `EmptyState`     | the reassuring line with an optional icon                                                                            | server      |
| `Skeleton`       | static tint blocks; tint animation only without reduced motion                                                       | server      |
| `VisuallyHidden` | screen-reader-only text                                                                                              | server      |

**The callback task row** (proposal; see the review package):

- **Title:** the h3 is exactly the API title, for example "Rückruf: Reservierung". It names the reason for the call; the row adds no other summary.
- **Status:** `<dt>` "Status" (visually hidden) and the neutral chip "Offen".
- **Anrufer:** `<dt>` "Anrufer" (visually hidden) and the caller number as a `tel:` link (§3.1, call link). Its accessible name and visible text are the number exactly as the API sends it. The number isn't regrouped or reformatted (an open founder decision).
- **Eingegangen:** `<dt>` "Eingegangen" (visible below 1100 px; from 1100 px the column label names it) and the `<time>` element with the existing `formatCreatedAt` format, unchanged.
- **Action:**
  - "Erledigt", the outlined button, keeps `aria-label="Erledigt: <title>"`.
  - When completion isn't available, the existing `complete-unavailable` line replaces it in warning style, on its own full-width line under the row.
- **Urgent:** a 4 px left bar in `--color-urgent` plus the "Dringend" chip with its icon before the title. The row stays in the Dringend section.

**Conventions.**

- `@moin/ui` imports nothing from `@moin/contracts`, `next/headers`, `fetch` or app code. Mapping data to components (`sectionOf`, `statusLabel`, `completeControlOf`, `t()`) stays in `apps/web`.
- Variants use `class-variance-authority`, and classes are merged with `clsx` plus `tailwind-merge`. Components take no inline `style` props.
- Every component forwards `className`, `id`, `aria-*` and `data-*`.

**Preserved test and interaction contracts** (unchanged by any redesign):

- `data-task-id` on each task (the row's `<li>`);
- `data-testid="action-notice"` and `data-testid="complete-unavailable"`;
- the region named "Rückrufe" (and the other section names);
- the h1 "Heute"; task h3 titles;
- the button named `Erledigt: <title>`;
- the links "Anmelden", "Aktualisieren" and the caller number;
- the text "Offen" in the task; "Alles erledigt." in every empty section; "Bitte melden Sie sich an …";
- `role="alert"` on the error;
- `<time>`;
- the outcome notice (`role="status"`) outside every task, receiving focus after an action.

## 6. States

| State                        | Treatment                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed out                   | page header, `today.signedOut` text, "Anmelden" as a primary link to `/api/auth/login`                                                                                                    |
| Loading                      | one panel with skeleton rows at the real row height plus the existing `role="status"` text "Aufgaben werden geladen …"; no shimmer                                                        |
| Empty                        | all five sections in one quiet panel, each with its heading and "Alles erledigt."                                                                                                         |
| Populated                    | section panels and task rows per §4 and §5; counts per §2                                                                                                                                 |
| Truncated                    | `role="note"` truncation text below the header; no counts; empty sections say `today.noneShown` in the quiet panel                                                                        |
| Error (read failed)          | warning alert (`role="alert"`) with `today.error` and "Neu laden"                                                                                                                         |
| Degraded: refresh delayed    | only after more than 2 minutes of failed refreshes on a visible, attended page; never because the tab was hidden, the owner was idle or nothing changed. Full rules in §6.1. Never "live" |
| Degraded: action unavailable | the row keeps its facts; `today.complete.unavailable` replaces the button on a full-width line under the row                                                                              |
| After an action              | the outcome notice above the sections, success or warning tone by result, with focus                                                                                                      |

### 6.1 Refresh health (proposed future behaviour, not implemented)

Everything in this section is **proposed**. None of it exists in the current code, and none of it is VERIFIED. It implements P13.10.02 ("stale-data indicator after 2 min without updates"), read here as "2 minutes without a **successful refresh**", not "2 minutes without new tasks". The founder confirms that reading (DG-10 record, "Founder decisions").

**Today's polling, as built** (`apps/web/lib/live-today.ts`, `apps/web/app/live-today.tsx`, M2B):

- a visible, attended tab polls `GET /api/today` every 15 s (`LIVE_POLL_MS`), each request timing out after 8 s;
- a failure backs off to 30 s, 60 s, then at most 120 s between attempts (`LIVE_BACKOFF_MAX_MS`), with ±10% jitter, and leaves the list on screen;
- a hidden tab, or a tab without input for 30 minutes (`LIVE_IDLE_MS`), stops polling. Showing the tab, coming back online, or the first input after the idle pause polls at once (`wake`);
- a 401 hands over to the server render, which shows the signed-out state and unmounts the poller;
- an unchanged answer does nothing; a changed one calls `router.refresh()`.

**What the code doesn't provide yet.** `startLivePoll` reports only "the list changed" (`onChange`). It reports no unchanged success, no failure, no time of the last success and no suspension or resumption; its failure count is internal. `LiveToday` renders nothing, and the page has no status line. This behaviour therefore **needs a change to the poller's state machine**: it must report each attempt's result with its time, and when polling is suspended or resumed. It also needs `LiveToday` (or a sibling client component) to render the status line and the notice. That change adds markup, not requests: the client still makes only the existing same-origin read (ADR-0025 D1).

**The failure clock.** All rules hang on one client-side clock:

- It **starts** when an attempt fails and no failure is already being timed since the last success.
- It **runs only while the page is visible and attended.** Hidden and idle time pauses it; it neither advances nor resets.
- It **resets to zero** on any successful read, changed or unchanged.

A failed attempt is a network error, the 8 s timeout, any status other than 200 and 401, or a body the contract parser rejects.

**States:**

| State                                    | Condition                                                         | Treatment                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial loading                          | the server is rendering the first page                            | `loading.tsx`: skeleton plus "Aufgaben werden geladen …" (§6 Loading)                                                                                                        |
| Initial-load failure                     | the server read failed                                            | the existing immediate `role="alert"` with `today.error` and "Neu laden". No list, so no refresh-health notice. Polling continues, and the first success re-renders the page |
| Healthy polling                          | visible, attended, last attempt succeeded                         | "Stand HH:MM" in muted text                                                                                                                                                  |
| Successful refresh, unchanged answer     | a 200 whose fingerprint equals the rendered one                   | counts as success: the clock resets, "Stand" advances to this read's time, any notice clears. No server re-render                                                            |
| Failed attempts, under 2 minutes         | visible, attended, clock between 0 and 2 minutes                  | **no visible change**: the list and "Stand HH:MM" (still the last success) stay. Backoff retries as built                                                                    |
| Refresh delayed                          | clock above 2 minutes **and** the latest completed attempt failed | "Stand HH:MM" turns to the warning tone with an icon, and the notice below appears                                                                                           |
| Hidden tab                               | `document.visibilityState` is not `visible`                       | polling suspended, clock paused, nothing raised. Unseen, so no notice can appear meanwhile                                                                                   |
| Idle                                     | no input for 30 minutes                                           | the same as a hidden tab                                                                                                                                                     |
| Returning (tab shown, input, online)     | suspension ends                                                   | an immediate recovery poll (`wake`). Until it completes, no notice is **newly** raised: the clock was paused, so it can't have crossed 2 minutes                             |
| Recovery                                 | any later successful read                                         | the clock resets, the notice disappears, "Stand" advances, and a changed list re-renders                                                                                     |
| Session expired or authentication failed | the poll gets 401                                                 | the existing authentication path: server render, signed-out state, "Anmelden". A 401 that render doesn't confirm counts as a failed attempt                                  |

**The notice** (proposed wording; it enters `de.json` only at implementation):

- **Title:** "Aktualisierung verzögert"
- **Text:** "Die angezeigten Aufgaben sind möglicherweise nicht auf dem neuesten Stand. Bitte aktualisieren Sie die Seite."
- **Presentation:** a warning `Alert` below the page header, with `role="status"` (polite). It never takes focus, because it appears without user action. The existing "Aktualisieren" link is the action.

**It is never raised because:**

- no new callbacks arrived;
- the last successful answer was unchanged;
- the tab was hidden;
- polling was suspended while idle;
- the owner returned and the recovery poll hasn't completed yet.

Only failed attempts on a visible, attended page move the clock.

**Implementation and acceptance: UX-01 refresh-health gate (RH).** RH is its own gate and PR, separate from styling. Its markup can use the tokens if they exist by then and the existing unstyled markup otherwise. It is accepted only with these executable proofs, each run on the real code:

1. A successful unchanged answer resets the clock, advances "Stand" and clears the notice, without a server re-render (unit test of the poller's state logic with fake timers).
2. Failed attempts on a visible, attended page raise the notice after more than 2 minutes, and not before (unit; plus one slice E2E with the API made unreachable).
3. Hidden-tab and idle suspension never raise a notice, however long they last, including 2 minutes or more after an earlier failure (unit).
4. Showing the tab, coming back online, or the first input after an idle pause starts an immediate recovery poll (unit; the existing "polls at once when it is shown again" test stays green).
5. A successful recovery clears the notice (unit and slice E2E).
6. An initial-load failure keeps its existing immediate `role="alert"` treatment, and no refresh-health notice appears (existing page tests plus one assertion).
7. Session expiry goes through the existing authentication path: on a confirmed 401 the signed-out state renders (existing behaviour; regression test).
8. The retained list, interval, backoff, timeout, idle rule, no-overlap rule and `router.refresh` on change behave as today, unless a change is intended, named in the PR and tested. The existing `apps/web/lib/live-today.test.ts` cases and `e2e/vertical-slice/today-callback.spec.ts` pass unchanged.

The regression tests are mutation-checked. RH supplies the stale-indicator half of P13.10.03. The SSE half stays open until the API has an event stream (ADR-0025 D4).

## 7. Interaction rules

- Each task has one action ("Erledigt"), always in the same place: the last column on desktop, bottom right on a phone. Calling is the link on the number.
- **No optimistic UI.** A row leaves only after the server re-read, as today.
- A second activation while pending does nothing.
- No hover-only information, no modal for a single-step action, and no swipe-only gesture.
- Tab order: skip link → navigation → "Aktualisieren" → per task, caller link then "Erledigt", top to bottom. The visual order matches the DOM order at every width; layouts reposition cells with grid areas, never by reordering the DOM.

## 8. What external design inputs may do

- **May:** suggest proportions, spacing rhythm, contrast pairs, critique findings and motion restraint. Each suggestion is re-checked against this file before use.
- **May not:**
  - add typefaces, gradients, glass, decorative imagery, scroll effects, entrance animation, KPI tiles or invented numbers;
  - move authenticated requests into the browser or change the server and client split;
  - write into the repository root, `CLAUDE.md` or the control plane;
  - imitate another company's brand.

## 9. What the implementation must still prove

The mock-ups and their checks ([review/README.md](review/README.md)) are static. They prove nothing about the application. Each UX-01 implementation gate must show these on the real Heute, as executable tests unless marked manual:

| Area                          | Required proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard and focus            | every control reachable in the §7 order; a visible 3 px focus ring on every stop (computed outline width); focus never hidden behind sticky content (WCAG 2.4.11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Screen-reader reading of rows | each row announces title, status, caller and receipt time from its own `<dt>`/`<dd>` pairs, with the `aria-hidden` column labels not read. Manual NVDA (Windows) and VoiceOver (iOS) pass, recorded per release (P13.12.02)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Pending-state label           | today the pending button shows "Wird gespeichert …" while its accessible name stays `Erledigt: <title>` (`apps/web/app/complete-action.tsx`), so the visible label is not in the name (WCAG 2.5.3). The implementation resolves this. The mock-ups and the DG-10 prototype use one proposed answer: while pending, the name becomes `Wird gespeichert …: <title>` (checked by `review/checks.mjs`). One option is to keep "Erledigt" in the visible label while pending, and announce the busy state through `aria-busy` and the outcome notice. It must keep the `Erledigt: <title>` name at rest, which the tests rely on. Verified with a screen reader, not only by axe |
| Tap targets                   | every link and button at least 44 × 44 px and 8 px apart at 320, 360, 390 and 768 px                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Reflow                        | no horizontal scroll at 320 CSS px and at 200% text zoom; the 72-character title wraps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Reduced motion                | every transition and animation duration on Heute is 0 under `prefers-reduced-motion: reduce`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| German long text              | the longest section heading and title wrap without clipping or overlap at every width; numbers and times don't break                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Contrast and high contrast    | every pair in §3.1 asserted in `packages/ui/src/tokens.test.ts`; under `forced-colors: active` the action outline, chips, focus ring and urgent bar stay distinguishable (the urgent meaning is carried by the "Dringend" text)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Browser function              | the existing vertical-slice, packaged-demo and smoke assertions pass unchanged; the selectors in §5 are only ever added to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Visual regression             | the deterministic baselines of [visual-regression-plan.md](visual-regression-plan.md), with CI never writing a baseline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Owner usability               | the [owner test](owner-usability-test.md), including C5: "Erledigt" found without prompting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
