# Owner app design system (DESIGN.md)

- **Status:** PROPOSED: pending founder acceptance (UX-01 Gate 0). Not binding until the founder accepts it, and nothing here is implemented yet.
- **Scope:** the owner web app (`apps/web`) and its shared components (`packages/ui`). It does not cover marketing pages or the Keycloak sign-in theme.
- **Decided with:** [DG-10](../decisions/DG-10-owner-app-visual-language.md) (visual language) and [ADR-0025](../adr/0025-frontend-architecture.md) (frontend architecture).
- **Review package:** [review/README.md](review/README.md) (proposal mock-ups, not screenshots of the app).

## 0. Authority

When sources disagree, the higher one wins:

1. PLAN, the invariants (INV-01…INV-20), security, accessibility (WCAG 2.2 AA, P13.12) and repository governance.
2. The founder-approved DG-10 decision.
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
  - A section shows its count only when the API returns `truncated: false`. Then the count equals the number of cards rendered.
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
- **Personal data:** the caller number appears only on its card and as its `tel:` link. It never goes in the page title, the URL, a notice or a log.

## 3. Tokens

All values are CSS custom properties declared once in `packages/ui/src/tokens.css` inside Tailwind's `@theme` (ADR-0025 D2). Components reference tokens only; a raw colour value in a component fails review.

### 3.1 Colour (light mode)

Contrast follows WCAG 2.x relative luminance. "Surface" is `#FFFFFF`, "canvas" is the page background. A ratio of 4.5:1 or more is required for text and 3:1 or more for control boundaries and focus indicators.

| Token                     | Value     | Role                                   | Contrast                                               |
| ------------------------- | --------- | -------------------------------------- | ------------------------------------------------------ |
| `--color-canvas`          | `#F6F5F2` | page background (warm neutral)         | —                                                      |
| `--color-surface`         | `#FFFFFF` | header, cards                          | —                                                      |
| `--color-surface-sunken`  | `#EFEDE9` | skeletons, hover of secondary controls | —                                                      |
| `--color-text`            | `#1C1B19` | running text, headings                 | 17.2 on surface · 15.8 on canvas · 14.7 on sunken      |
| `--color-text-muted`      | `#57534E` | labels, times, secondary lines         | 7.6 on surface · 7.0 on canvas · 6.5 on sunken         |
| `--color-border`          | `#DDD9D2` | card outline, header rule (decorative) | 1.3–1.4 (not a control boundary)                       |
| `--color-border-control`  | `#8A847C` | secondary-button outline               | 3.7 on surface · 3.4 on canvas · 3.2 on sunken (hover) |
| `--color-primary`         | `#1D5FA8` | primary fill, links, focus ring        | 6.5 on surface · 5.9 on canvas                         |
| `--color-primary-hover`   | `#174C86` | hover fill and hovered link text       | 8.7 (white on it) · 8.7 on surface                     |
| `--color-primary-pressed` | `#123D6C` | pressed fill                           | 11.0 (white on it)                                     |
| `--color-on-primary`      | `#FFFFFF` | text and icons on primary fills        | 6.5 / 8.7 / 11.0 by state                              |
| `--color-info-bg`         | `#EAF1FA` | "Offen" badge ground                   | primary text on it 5.7                                 |
| `--color-urgent`          | `#B42318` | Dringend text, icon and card bar       | 6.6 on surface                                         |
| `--color-urgent-bg`       | `#FDF1EF` | Dringend badge ground                  | urgent text on it 6.0                                  |
| `--color-success`         | `#1E6B3A` | confirmed outcome                      | 5.9 on its background                                  |
| `--color-success-bg`      | `#EDF6EF` | outcome notice ground                  | —                                                      |
| `--color-warning`         | `#8A5300` | stale, degraded, "nicht möglich"       | 5.8 on its background                                  |
| `--color-warning-bg`      | `#FDF5E4` | error and degraded alert ground        | —                                                      |

**Interaction states.**

- **Primary button:** `primary` → hover `primary-hover` → pressed `primary-pressed`, with white text at 6.5, 8.7 and 11.0.
- **Focus:** the ring is `--color-primary`, 3 px, offset 2 px. It always sits on the surface or canvas behind the control (5.9 or more), never on the button's own fill.
- **Pending:** a pending action keeps full-contrast text ("Wird gespeichert …") with `aria-busy`. The interface has no low-contrast greyed-out "disabled" style.

### 3.2 Status semantics

| Meaning                          | Visual                                          | Text (from `de.json`)                                   |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Needs attention now (`urgent`)   | urgent badge plus a 4 px urgent bar on the card | badge "Dringend"; section heading "Dringend"            |
| Open                             | primary text on info background                 | "Offen"                                                 |
| In progress or waiting           | muted text on sunken background                 | "In Bearbeitung", "Wartet"                              |
| Outcome confirmed by the API     | success notice with a check icon                | `today.complete.done`                                   |
| Read failed, stale, not possible | warning alert with an icon                      | `today.error`, `today.complete.unavailable`, stale line |

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
| Card title    | 1.125 / 18                         | 1.3         | 600    |
| Section title | 1.25 / 20                          | 1.3         | 600    |
| Page title    | 1.625 / 26, from 768 px 1.875 / 30 | 1.2         | 650    |

### 3.4 Space, borders, radius and elevation

| Token         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| Spacing scale | 4 · 8 · 12 · 16 · 24 · 32 · 48 px                                                  |
| Page gutter   | 16 px below 768 px · 24 px from 768 · 32 px from 1280                              |
| Content frame | max 72rem (1152 px), centred; content left-aligned                                 |
| Card padding  | 16 px (phone) · 20 px (from 768 px)                                                |
| Gaps          | 32 px between sections · 12 px between cards (phone) · 16 px from 768              |
| Touch target  | 44 × 44 px or more, at least 8 px apart                                            |
| Borders       | 1 px `--color-border` on cards and the header; controls `--color-border-control`   |
| Radius        | 6 px controls · 10 px cards · full for badges                                      |
| Elevation     | none at rest; one soft shadow is reserved for future floating layers               |
| Focus         | `outline: 3px solid var(--color-primary); outline-offset: 2px` on `:focus-visible` |

### 3.5 Motion

Motion is feedback only:

- the press state, which is immediate;
- the outcome notice fading in (opacity, 150 ms, ease-out);
- the skeleton tint, which is static under reduced motion.

There are no entrance animations, staggered reveals, hover scaling, scroll effects, animated counters or pulsing "live" dots. Keyboard-initiated actions are never animated. Under `prefers-reduced-motion: reduce` every transition and animation duration is 0.

## 4. Layout

**Application shell.**

- A white top bar holds the product name and the navigation.
  - The name comes from `NEXT_PUBLIC_BRAND_NAME`, never a literal (ADR-0034).
  - Today the only navigation entry is "Heute". The other BR-060 areas appear only when they ship. "Abmelden" comes with the logout flow (P13.01.01).
- The active entry is marked by `aria-current="page"`, weight 600 and a 2 px primary underline, not by colour alone.
- The skip link "Zum Inhalt springen" stays first in tab order.

**Page header.**

- The h1 is "Heute", followed by the date in German long form.
- The status line reads "Stand HH:MM", the time of the last successful read of the task list.
- "Aktualisieren" stays a **link** styled as a secondary button.

**Sections.**

- Sections appear in PLAN order: Dringend · Rückrufe · Neue Anfragen · Termine/Reservierungen zu bestätigen · Offene Kundenfragen.
- The `<section>` stays labelled by its heading text alone (`aria-labelledby` on the heading's text element). Its accessible name therefore stays exactly "Rückrufe" etc.
- The count (§2) is a separate element next to it, outside that label.
- An empty section keeps its heading and shows "Alles erledigt." in muted text with a check icon, compactly.

**Cards.**

- One column below 768 px. From 768 px, `repeat(auto-fill, minmax(20rem, 1fr))`.
- The order is exactly the API's (urgent first, then newest).

**Wide screens.** The frame stays at 72rem. There are no stretched text lines and no side panels with invented content.

## 5. Components (`@moin/ui`)

| Component        | Contract                                                                            | Rendering   |
| ---------------- | ----------------------------------------------------------------------------------- | ----------- |
| `AppShell`       | skip link, top bar, navigation, `<main id="inhalt">`                                | server      |
| `PageHeader`     | h1, date, a status-line slot, an actions slot                                       | server      |
| `Section`        | `<section aria-labelledby>`, h2, an optional count element, empty line, list        | server      |
| `TaskCard`       | `<li><article aria-labelledby>`: h3 title, status badge, facts `<dl>`, actions slot | server      |
| `StatusBadge`    | text plus tone from a status value; the text is always rendered                     | server      |
| `Button`         | variants `primary`, `secondary`, `quiet`; renders `<button>` or `<a>`               | server-safe |
| `Alert`          | tones `info`, `warning`, `urgent`; the caller passes the `role`                     | server      |
| `EmptyState`     | the reassuring line with an optional icon                                           | server      |
| `Skeleton`       | static tint blocks; tint animation only without reduced motion                      | server      |
| `VisuallyHidden` | screen-reader-only text                                                             | server      |

**The callback task card** (proposal; see the review package):

- **Header row:** the h3 title (exactly the API title, for example "Rückruf: Reservierung") and the status badge ("Offen"). The badge carries visually hidden "Status:" text before it.
- **Facts:**
  - "Anrufer": the caller number as a `tel:` link styled as a 44 px secondary control with a phone icon. Its accessible name is the number as the API sends it.
  - "Eingegangen": the `<time>` element with the existing `formatCreatedAt` format.
- **Actions:**
  - "Erledigt", the primary button, keeps `aria-label="Erledigt: <title>"`.
  - When completion isn't available, the existing `complete-unavailable` line replaces it in warning style.
- **Urgent:** a 4 px left bar in `--color-urgent` plus the "Dringend" badge. The card stays in the Dringend section.

**Conventions.**

- `@moin/ui` imports nothing from `@moin/contracts`, `next/headers`, `fetch` or app code. Mapping data to components (`sectionOf`, `statusLabel`, `completeControlOf`, `t()`) stays in `apps/web`.
- Variants use `class-variance-authority`, and classes are merged with `clsx` plus `tailwind-merge`. Components take no inline `style` props.
- Every component forwards `className`, `id`, `aria-*` and `data-*`.

**Preserved test and interaction contracts** (unchanged by any redesign):

- `data-task-id` on each card;
- `data-testid="action-notice"` and `data-testid="complete-unavailable"`;
- the region named "Rückrufe" (and the other section names);
- the h1 "Heute"; card h3 titles;
- the button named `Erledigt: <title>`;
- the links "Anmelden", "Aktualisieren" and the caller number;
- the text "Offen" in the card; "Alles erledigt."; "Bitte melden Sie sich an …";
- `role="alert"` on the error;
- `<time>`;
- the outcome notice outside every card, receiving focus after an action.

## 6. States

| State                        | Treatment                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed out                   | page header, `today.signedOut` text, "Anmelden" as a primary link to `/api/auth/login`                                                                                                                    |
| Loading                      | three skeleton cards in the section frame plus the existing `role="status"` text "Aufgaben werden geladen …"                                                                                              |
| Empty                        | every section shows its heading and "Alles erledigt."                                                                                                                                                     |
| Populated                    | cards per §5; counts per §2                                                                                                                                                                               |
| Truncated                    | `role="note"` truncation text below the header; no counts; empty sections say `today.noneShown`                                                                                                           |
| Error (read failed)          | warning alert (`role="alert"`) with `today.error` and "Neu laden"                                                                                                                                         |
| Degraded: stale              | the status line switches to the warning tone, "Stand HH:MM · Aktualisierung fehlgeschlagen". After 2 minutes without a successful read, the view is marked possibly out of date (P13.10.02). Never "live" |
| Degraded: action unavailable | the card keeps its facts; `today.complete.unavailable` replaces the button                                                                                                                                |
| After an action              | the outcome notice above the sections, success or warning tone by result, with focus                                                                                                                      |

## 7. Interaction rules

- Each card has one primary action ("Erledigt"); calling is the secondary control on the number.
- **No optimistic UI.** A card leaves only after the server re-read, as today.
- A second activation while pending does nothing.
- No hover-only information, no modal for a single-step action, and no swipe-only gesture.
- Tab order: skip link → navigation → "Aktualisieren" → per card, caller link then "Erledigt", in reading order.

## 8. What external design inputs may do

- **May:** suggest proportions, spacing rhythm, contrast pairs, critique findings and motion restraint. Each suggestion is re-checked against this file before use.
- **May not:**
  - add typefaces, gradients, glass, decorative imagery, scroll effects, entrance animation, KPI tiles or invented numbers;
  - move authenticated requests into the browser or change the server and client split;
  - write into the repository root, `CLAUDE.md` or the control plane;
  - imitate another company's brand.
