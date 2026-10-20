# UX-01 Gate 0: founder design-review package

- **Status:** PROPOSAL for founder review. **Every image here is a static mock-up** built from the tokens in [../DESIGN.md](../DESIGN.md). **None is a screenshot of the implemented application.** Each mock-up carries a visible "Entwurf" label, and all data is synthetic.
- **Decisions under review:**
  - [DG-10](../../decisions/DG-10-owner-app-visual-language.md)
  - [ADR-0025](../../adr/0025-frontend-architecture.md)
  - [DESIGN.md](../DESIGN.md)
  - [visual-regression-plan.md](../visual-regression-plan.md)
  - [design-references.md](../design-references.md)

## How the images were made

- **Source:** the HTML pages in [mockups/](mockups/) and the shared [mockups/proposal.css](mockups/proposal.css), which mirrors DESIGN.md §3. Nothing in `mockups/` is imported by `apps/web` or `packages/ui`.
- **Rendering:**
  - Playwright 1.63.0 Chromium (the repository's pinned test browser), from local files;
  - device scale 1, `de-DE`, `Europe/Berlin`, reduced motion;
  - full-page captures. No page scrolls horizontally at any rendered width.
- **Fonts:** the system font stack resolved on the rendering machine (Linux, a DejaVu-family sans). On owners' devices the same stack resolves to Segoe UI (Windows), San Francisco (Apple) or Roboto (Android), so letterforms and line breaks differ slightly from these images.
- **What these images are not:** executable acceptance evidence. That comes only from the gates in [visual-regression-plan.md](../visual-regression-plan.md), run against the real application.

## A. Colour tokens and contrast

![Foundations: tokens, type, spacing, buttons, status](images/foundations-1440.png)

- Every text pair is 4.5:1 or more, and control boundaries and focus rings are 3:1 or more. The full table is in DESIGN.md §3.1.
- **Correction after independent review:** the "Bedienrahmen" swatch label was white on `#8A847C` (3.70:1, below 4.5:1). It is now `--color-text` `#1C1B19` on the same swatch (4.65:1). The control-border token is unchanged, because it is a 3:1 boundary colour, not a text ground. A computed-style audit of every visible text element in the four mock-ups at 390 and 1440 px now finds no pair below its WCAG threshold.
- **The primary blue `#1D5FA8` in each state:** default 6.5:1, hover 8.7:1, pressed 11.0:1 (white text on each). The focus ring is 6.5:1 on white and 5.9:1 on the canvas.
- There is no decorative warm accent (DG-10). The warmth is in the neutral ground `#F6F5F2` and the text greys.

## B. Typography and spacing

The same sheet as A.

- **Type:** the system font stack, six sizes (13–30 px), weights 400, 600 and 650, sentence case throughout, tabular figures for times and numbers.
- **Space:** a 4-step base scale (4–48 px); radii of 6 px for controls and 10 px for cards; 44 px minimum targets.

## C. Navigation and application shell

Visible at the top of every Heute image.

- **Bar:** a white bar with the product name, which in the app comes from `NEXT_PUBLIC_BRAND_NAME` (ADR-0034), and the navigation.
- **Navigation:** only "Heute" exists today. The active entry is marked by weight, a 2 px underline and `aria-current`, not colour alone. Further entries appear only when their views ship.
- **No placeholders:** no account menu or logout is drawn, because neither exists yet (P13.01.01).

## D. Heute: empty

| Desktop 1440 px                                      | Mobile 390 px                                      |
| ---------------------------------------------------- | -------------------------------------------------- |
| ![Heute empty, desktop](images/heute-empty-1440.png) | ![Heute empty, mobile](images/heute-empty-390.png) |

- All five sections keep their headings in PLAN order. Each shows the existing line "Alles erledigt." with a check icon.
- No count is drawn for empty sections.

## E. Heute: populated with synthetic callback tasks

![Heute populated, desktop 1440 px](images/heute-populated-1440.png)

- Four synthetic tasks use the four authorised callback titles. One is urgent.
- **Counts:** shown here because a list of four is not truncated. With `truncated: true` no count is drawn (see H).
- **Empty sections:** collapse to one quiet row each, so open work dominates the page.

## F. Callback task card and its actions

Shown in E, and in H for the focused, unavailable and urgent variants.

- **Title:** the h3 is exactly the API's title.
- **Status:** a text badge ("Offen") with visually hidden "Status:" text before it. Urgent adds a "Dringend" badge with an icon and a 4 px red bar.
- **Anrufer:** the number as a 44 px `tel:` control. Its accessible name is the number exactly as today.
- **Eingegangen:** the existing `<time>` format.
- **Erledigt:** the one primary action; its accessible name stays `Erledigt: <title>`.
- **When completion isn't available:** the existing sentence replaces the button, in the warning tone.

## G. Mobile layout

| Populated 390 px                                           | Tablet 768 px (grid begins)                                |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| ![Heute populated, mobile](images/heute-populated-390.png) | ![Heute populated, tablet](images/heute-populated-768.png) |

- **Below 768 px:** one column. "Erledigt" spans the card width as a full-width thumb target.
- **The status line and "Aktualisieren"** wrap under the date.
- **Long German headings** ("Termine/Reservierungen zu bestätigen", "Rückruf: Reservierung für Geburtstagsfeier") wrap onto a second line without overflow.

## H. Loading, error and degraded behaviour

| Desktop 1440 px                                        | Mobile 390 px                                        |
| ------------------------------------------------------ | ---------------------------------------------------- |
| ![Heute states, desktop](images/heute-states-1440.png) | ![Heute states, mobile](images/heute-states-390.png) |

Shown from top to bottom:

1. signed out;
2. loading (skeleton plus the existing status text);
3. read failed (warning alert with "Neu laden");
4. refresh delayed: more than 2 minutes of failed refreshes on a visible, attended page, with the list still shown ("Aktualisierung verzögert", [DESIGN.md](../DESIGN.md) §6.1). This is proposed future behaviour; today's polling doesn't expose the state it needs. Brief failures, a hidden tab and an idle pause show no notice, so they have no image;
5. completion unavailable on an older API;
6. truncated list (no counts);
7. after "Erledigt" (the success notice, which receives focus);
8. keyboard focus on "Erledigt".

The dashed "Zustand" and "Anmerkung" labels explain the mock-up only and are not part of the design. The wording of the refresh-delayed notice and its 2-minute threshold (P13.10.02) are proposals that enter `de.json` only at implementation (refresh-health gate RH).

**Images regenerated after independent review:** `foundations-1440.png` (contrast correction) and `heute-states-1440.png` / `-390.png` (state 4). The other five images are unchanged: re-rendering their unchanged sources in the same environment reproduced them byte for byte.

## I. What changes compared with today's unstyled Heute

**No before screenshot from the application is part of this package.** The executable before set is captured from the main commit in UX-01 gate 2a ([visual-regression-plan.md](../visual-regression-plan.md) §6), and until then there is no comparison to report.

From the current source (`apps/web/app/layout.tsx`, `apps/web/app/page.tsx`), today's page:

- **Font:** sets no font family, so the browser default (typically a serif) renders everything.
- **Width:**
  - a 360 px column below a 768 px viewport;
  - 768 px up to a 1280 px viewport;
  - 1280 px wide above that, so lines run very long on desktop.
- **Elements:** browser-default bullets, underlined blue links and a two-column `<dl>`.
- **Cards and buttons:** a 1 px grey border on each card, and a black-outlined white "Erledigt" button.
- **Status:** shown as a plain "Status: Offen" row; urgent work isn't visually distinguished beyond its section.

**What the proposal changes:**

1. **Hierarchy:** one type scale, with the h1 and the date first, and the status line and refresh together.
2. **Finding work:** urgent work has its own accent bar and badge, open callbacks sit in a grid on desktop, and empty sections shrink to a quiet line.
3. **Clear actions:** one filled primary "Erledigt" per card, with the call action as a recognisable control on the number.
4. **Trust:**
   - the "Stand HH:MM" freshness line and honest degraded states;
   - counts only when they are the whole truth;
   - no decorative or invented numbers.
5. **Accessibility:** tested contrast, 44 px targets, a visible 3 px focus ring, and status never shown by colour alone.

**What it does not change:** the data flow, the API, authentication, CSRF, live updates, the completion behaviour and every test selector (DESIGN.md §5).
