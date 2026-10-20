# DG-10 owner-test prototype

- **What it is:** test material for the owner usability test that DG-10 requires ([plan](../owner-usability-test.md)). It is a static, in-browser **simulation** of Heute in the work-queue layout ([DESIGN.md](../DESIGN.md) §4) with synthetic data. It is **not** the owner app, not P13.01 work, and not a source of application code.
- **Authority:** the founder's recorded preparatory exception of 2026-10-20 ([DG-10 record](../../decisions/DG-10-owner-app-visual-language.md), "Recorded founder decisions"). It expires when DG-10 is decided or on 2026-12-31, whichever comes first. DG-10 stays PROVISIONAL, and P13.01 stays blocked.
- **Version:** `DG-10-Prototyp 1`, shown on the moderator page and set as `data-version` on the participant page. Every session record names the version, the commit SHA and the file digest (§4).

## 1. What is simulated and what is real

| Behaviour                                              | In the prototype                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task list                                              | four synthetic callbacks ("Morgen") or ten ("Volle Liste"), the four canonical titles, `+49 30 0000…` fixture numbers                                              |
| "Erledigt"                                             | **simulated:** a 1.2 s pending state, then the row leaves and the outcome notice takes focus. The completion is stored only in this browser tab (`sessionStorage`) |
| Loading, read error                                    | **simulated:** a 1.8 s placeholder; a first load that fails until "Neu laden"                                                                                      |
| Completion unavailable                                 | **simulated** on one task ("Erledigt nicht möglich")                                                                                                               |
| Call link                                              | a real `tel:` link. On a phone it opens the dialler with an invalid fixture number; the participant cancels                                                        |
| "Stand HH:MM"                                          | a synthetic clock starting at 09:42                                                                                                                                |
| Server, database, sign-in, live updates, CSRF, tenants | **none.** Nothing here shows that any of them work                                                                                                                 |

**Network behaviour, precisely:**

| What                                                     | In the prototype                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| The page's own files (HTML, CSS, JS)                     | loaded by the browser from local files (`file://`). No server is run (DG-10 record)                                           |
| State in the browser                                     | the tab's `sessionStorage` only: which tasks were completed in this scenario, and a session marker. It is never sent anywhere |
| Programmatic connections (fetch, XHR, WebSocket, beacon) | none in the code, and blocked by the CSP `connect-src 'none'`                                                                 |
| External APIs, analytics, telemetry, fonts, images       | none: the CSP allows only the page's own files                                                                                |
| Navigations                                              | "Aktualisieren", "Neu laden" and the moderator links reload the page's own file                                               |
| Call links                                               | a `tel:` link hands the number to the device's phone app, which happens outside the page                                      |
| Server access logs                                       | none, because there is no server. A phone session would need one: see §3                                                      |

The check below asserts that every request the page makes is a local file. It can't say anything about a server that doesn't exist.

## 2. Isolation from the product

- The prototype lives under `docs/`, which is outside the pnpm workspace (`apps/*`, `packages/*`), outside every TypeScript project, and excluded from the image build context (`.dockerignore` lists `docs`). It can't reach the release image.
- It imports nothing from `apps/` or `packages/`, and nothing there imports it. It uses no dependency beyond the repository's existing Playwright and axe for its check.
- It reuses the review mock-ups' stylesheet ([../review/mockups/proposal.css](../review/mockups/proposal.css)), so participants see exactly the reviewed design.

## 3. Running a session

- **Laptop:** open `prototype/moderator.html` in Chrome or Edge, and start each scenario from there, in the same tab. Opening the files directly (`file://`) works.
- **Participant's phone: NOT AUTHORIZED.** A phone can't open files on the moderator's computer, and serving them over the network needs a server. The recorded exception excludes a server.
  - The [proposed amendment](../../decisions/DG-10-owner-app-visual-language.md#proposed-amendment-phone-access-over-the-local-network-not-authorized) (interface, port, logging, lifecycle, WSL2) waits for the founder's decision. Until it is approved and recorded, there is no phone procedure, and none may be improvised.
  - Without it, the phone tasks and C5's phone half stay "nicht getestet".
- **Session readiness:** **not ready** for a complete DG-10 session. Outstanding:
  - phone access (above);
  - the participant (an owner);
  - the founder's completion of the consent text;
  - confirmation of the C1–C8 thresholds;
  - the manual screen-reader passes.

- **Reset between participants:** each "Starten" link on the moderator page clears this tab's completions. Close the tab after the session.

## 4. Before every session

1. On the commit to be tested, run `node docs/design/owner-test/check-prototype.mjs` and `node docs/design/owner-test/check-concurrency.mjs` from the repository root. Both must report 0 failures; the concurrency check covers overlapping completions, resets and focus. It covers:
   - every scenario at 320, 360, 390, 640, 720, 768, 1280 and 1440 px (640 and 720 are a 1280 and 1440 px window at 200% zoom), plus 200% phone text size: no horizontal scroll, contrast, 44 px targets 8 px apart, labels inside names, no overlap in a row, the Heute contracts, and axe;
   - keyboard order and visible focus;
   - completing a task, state across "Aktualisieren", reset, all done;
   - loading, error and reload; the unavailable action; reduced motion; no network.
2. Record the version: `git rev-parse HEAD` and `sha256sum docs/design/owner-test/prototype/* docs/design/review/mockups/proposal.css`.
3. **Still needs a person:** keyboard-only and screen-reader use, with NVDA on Windows and VoiceOver on iOS. axe and the check prove neither. If a participant uses assistive technology, test the prototype with it first.

## 5. The session material

- [session-kit.md](session-kit.md): the runbook, the German moderator script, and the German consent and privacy text.
- [observation-sheet.md](observation-sheet.md): the session header, per-task measurements, the severity rubric, the separate DG-10 and P13 matrices, and the evidence location.
