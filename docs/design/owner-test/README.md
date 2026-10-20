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

The page sends nothing anywhere: its CSP has `connect-src 'none'`, and the check below asserts that no request leaves the device.

## 2. Isolation from the product

- The prototype lives under `docs/`, which is outside the pnpm workspace (`apps/*`, `packages/*`), outside every TypeScript project, and excluded from the image build context (`.dockerignore` lists `docs`). It can't reach the release image.
- It imports nothing from `apps/` or `packages/`, and nothing there imports it. It uses no dependency beyond the repository's existing Playwright and axe for its check.
- It reuses the review mock-ups' stylesheet ([../review/mockups/proposal.css](../review/mockups/proposal.css)), so participants see exactly the reviewed design.

## 3. Running a session

- **Laptop:** open `prototype/moderator.html` in Chrome or Edge, and start each scenario from there, in the same tab. Opening the files directly (`file://`) works.
- **Participant's phone:** the phone needs an HTTP address on the same local network. One way is a static server started from `docs/design` on a machine the phone can reach:

  ```bash
  python3 -m http.server 8080 --bind 0.0.0.0 --directory docs/design
  # phone: http://<laptop-address>:8080/owner-test/prototype/moderator.html
  ```

  - **WSL2:** a server inside WSL2 isn't reachable from the phone by default. Run it on the Windows host, or forward the port.
  - **Exposure:** never expose the server beyond the local network, and stop it after the session.

- **Reset between participants:** each "Starten" link on the moderator page clears this tab's completions. Close the tab after the session.

## 4. Before every session

1. On the commit to be tested, run `node docs/design/owner-test/check-prototype.mjs` from the repository root. It must report 0 failures. It covers:
   - every scenario at 320, 360, 390, 640, 720, 768, 1280 and 1440 px (640 and 720 are a 1280 and 1440 px window at 200% zoom), plus 200% phone text size: no horizontal scroll, contrast, 44 px targets 8 px apart, labels inside names, no overlap in a row, the Heute contracts, and axe;
   - keyboard order and visible focus;
   - completing a task, state across "Aktualisieren", reset, all done;
   - loading, error and reload; the unavailable action; reduced motion; no network.
2. Record the version: `git rev-parse HEAD` and `sha256sum docs/design/owner-test/prototype/* docs/design/review/mockups/proposal.css`.
3. **Still needs a person:** keyboard-only and screen-reader use, with NVDA on Windows and VoiceOver on iOS. axe and the check prove neither. If a participant uses assistive technology, test the prototype with it first.

## 5. The session material

- [session-kit.md](session-kit.md): the runbook, the German moderator script, and the German consent and privacy text.
- [observation-sheet.md](observation-sheet.md): the session header, per-task measurements, the severity rubric, the separate DG-10 and P13 matrices, and the evidence location.
