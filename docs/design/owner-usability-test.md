# Owner usability test for DG-10 (plan)

- **Status:** PLANNED, **not performed**. No participant has been tested, and this file holds no observations. It closes nothing: DG-10 stays PROVISIONAL until the test has taken place, its evidence record exists, and the founder decides on it ([DG-10 record](../decisions/DG-10-owner-app-visual-language.md)).
- **What it serves:**
  - PLAN's DG-10 row (L507): evidence required "Owner usability test", which blocks P13.01;
  - the provisional selection of the work-queue layout (Direction B) and its outlined "Erledigt" ([DESIGN.md](DESIGN.md) §3.1, §4).
- **What it doesn't replace:** P13's acceptance session ("Owner usability session with the Gurlitt owner: they complete the morning review of 10 synthetic items in < 5 minutes without help"). Whether one session may serve both is a founder decision (DG-10 record, decision 2). Task T11 below is written so it can.

## 1. Prerequisites (all founder-owned)

Before a session counts as DG-10 evidence:

1. **The sequencing decision** in the DG-10 record (decision 1): test before DG-10 is taken (a), or after a PLAN change (b).
2. **The artefact**, see §3:
   - The static mock-ups need nothing more.
   - Tasks marked "interactive" need the **interactive prototype**. The founder authorised it on 2026-10-20 as a narrowly scoped exception for this test only (DG-10 record, "Recorded founder decisions"). It is built in [owner-test/prototype/](owner-test/prototype/) and is not P13.01 work.
3. **A participant:** PLAN's DG-10 evidence is an **owner** usability test (L507).
   - **Who counts:** the owner of a small, phone-heavy restaurant who handles callbacks themselves, recruited by the founder. Only an owner's session counts as DG-10 evidence. Staff or operators may add findings but can't stand in for the owner.
   - **P13's session** names the Gurlitt owner (PLAN P13, acceptance criteria). If the sessions are combined, the participant must be that owner.
   - **Product principle:** the participant needs no AI or software knowledge (BLUEPRINT L58–64); the material contains no AI jargon (BR-060).
4. **Consent** to take part and to written notes. Audio, video and screen recording are made only with separate explicit consent, and recordings are stored outside the repository (§6).
5. **Synthetic data only.** No real customer, number or business data appears in the material or the notes.
   - The `+49 30 0000…` fixture numbers aren't valid subscriber numbers.
   - In task T3 the participant opens the dialler and cancels; no call is placed.

## 2. Format

- **Length:** 20–30 minutes, moderated, one participant at a time. One moderator (not the designer, if possible) and one note-taker.
- **Devices:** the participant's own phone for the phone tasks, and a laptop or desktop for the desktop tasks. The browser is set to German.
- **Method:** think aloud. The moderator reads the German prompts verbatim and never says the name of a control (especially "Erledigt") before the participant has found it. After a task the moderator asks "Was haben Sie erwartet?" and nothing leading.
- **Help:** the moderator gives a hint only after 60 seconds of no progress, and records it. A task with a hint is "assisted", not "passed".
- **Timing:** each task is timed from the end of the prompt to the participant's answer or action.

## 3. Artefacts

| Artefact                                                     | Where                                                                           | Interaction it supports                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static mock-up **images**                                    | [review/images/](review/images/)                                                | looking and pointing only                                                                                                                                     |
| Static mock-up **HTML pages**, opened on the device          | [review/mockups/](review/mockups/)                                              | real scrolling, real layout at the device's width, and `tel:` links that open the dialler; buttons do nothing                                                 |
| **Interactive prototype** (synthetic, in-browser simulation) | [owner-test/prototype/](owner-test/prototype/), moderator page `moderator.html` | completing a task, the pending state, the outcome notice, focus movement, the simulated re-read, the loading and error states; every task below can run on it |

**Phone delivery:** both the static HTML pages and the prototype reach a phone only through a server. That is **not authorised** until the founder approves the phone-access amendment in the DG-10 record. Until then, phone tasks are "nicht getestet".

Every session records exactly which artefact it used, with its commit SHA or image digest. The runbook, the per-task scenarios and the forms are in [owner-test/session-kit.md](owner-test/session-kit.md) and [owner-test/observation-sheet.md](owner-test/observation-sheet.md).

## 4. Tasks

German prompts are read verbatim. "Static" means the static HTML pages are enough; "interactive" means only the authorized prototype can produce evidence for the task.

| #   | What it assesses                      | Prompt (German)                                                                                                | Page                                                                         | Success                                                                               | Artefact                                               |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| T1  | locate the most urgent callback       | „Stellen Sie sich vor, Sie kommen morgens in den Betrieb. Welcher Rückruf ist am dringendsten?“                | `heute-busy.html`, desktop                                                   | points at a row in "Dringend" within 10 s                                             | static                                                 |
| T2  | recognise the reason for the call     | „Worum geht es bei diesem Rückruf?“ (on the row from T1, then on "Rückruf: Reservierung für Geburtstagsfeier") | same                                                                         | says the reason in their own words from the title                                     | static                                                 |
| T3  | find and use the phone link           | „Wie würden Sie die Person, die um 08:58 Uhr angerufen hat, jetzt zurückrufen?“                                | `heute-populated.html`, phone                                                | taps the number and the dialler opens with it, without help; then cancels             | static (HTML on the phone)                             |
| T4  | identify the next callback in order   | „Die dringenden Rückrufe sind erledigt. Welcher kommt als Nächstes?“                                           | `heute-busy.html`, desktop                                                   | names the first row under "Rückrufe" (the newest)                                     | static                                                 |
| T5  | discover "Erledigt" without prompting | „Sie haben die Person erreicht und alles geklärt. Was machen Sie jetzt hier auf der Seite?“                    | `heute-populated.html`, phone and desktop                                    | points at or taps "Erledigt" on that row within 10 s, with no hint                    | static for discovery; interactive for using it         |
| T6  | understand successful completion      | „Was ist gerade passiert?“ (after activating "Erledigt")                                                       | prototype                                                                    | says the callback is marked as done and has left the list; notices the confirmation   | **interactive**                                        |
| T7  | understand the empty state            | „Was sagt Ihnen diese Seite?“                                                                                  | `heute-empty.html`, phone                                                    | says nothing is waiting, in every area                                                | static                                                 |
| T8  | understand the loading state          | „Was passiert hier gerade?“                                                                                    | prototype with a slowed response; comprehension probe on `heute-states.html` | says the tasks are still loading; doesn't act on the placeholders                     | **interactive** (the static probe only checks wording) |
| T9  | understand the unavailable action     | „Was können Sie bei dieser Aufgabe tun?“                                                                       | `heute-actions.html`, "Erledigt nicht möglich"                               | says it can't be marked as done right now and the page should be reloaded later       | static                                                 |
| T10 | navigate the phone layout             | „Finden Sie den Rückruf wegen der Reservierung von gestern Abend um 21:13 Uhr.“                                | `heute-busy.html`, phone                                                     | scrolls to the right row and identifies it within 30 s, without help                  | static (HTML on the phone)                             |
| T11 | P13 morning review (if combined)      | „Gehen Sie Ihre Aufgaben von heute durch, so wie Sie es morgens tun würden.“                                   | prototype, 10 synthetic items                                                | completes the review of all 10 in < 5 minutes without help (P13 acceptance criterion) | **interactive**                                        |

T4 checks the layout's central claim, that the list reads top to bottom in the API's order (urgent first, then newest). T5 is the test of the provisional outlined action.

## 5. Pass criteria

These criteria are proposed; the founder confirms or changes them before the first session.

| #      | Criterion                                                                                                                          | Applies to               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| C1     | the most urgent callback found within 10 s, unassisted                                                                             | T1                       |
| C2     | the reason for the call stated from the title, unassisted                                                                          | T2                       |
| C3     | the phone dialler opened with the caller's number from the call link, unassisted (the participant then cancels; no call is placed) | T3                       |
| C4     | the next callback in order named correctly                                                                                         | T4                       |
| **C5** | **"Erledigt" found without prompting within 10 s, on phone and on desktop**                                                        | T5                       |
| C6     | completion understood                                                                                                              | T6 (interactive)         |
| C7     | empty, loading and unavailable states understood                                                                                   | T7, T8 (interactive), T9 |
| C8     | the phone layout navigated, unassisted                                                                                             | T10                      |

- **Outcome:**
  - DG-10 evidence is complete only when every criterion has been assessed on its required artefact and passed, or the founder records why a failed or untested criterion is accepted.
  - Static-only sessions leave C6, T8 and T11 **untested**, and the record says so.
- **If C5 fails:** "Erledigt" switches to the filled `primary` variant in the same position (DESIGN.md §3.1) and T5 is repeated with a participant who hasn't seen the page. Nothing else changes.
- **If two or more of C1, C2, C4 and C8 fail:** the layout is reconsidered before any implementation.

## 6. Recording the result

- **Evidence record:** `python3 .claude/bin/evidence.py new --phase P13 …` creates the next free P13 ID. PLAN's EV-P13-003 is already used by another record (DG-10 record).
- **What the record contains:**
  - date;
  - the artefact and its SHA or digest;
  - device and browser;
  - the participant's role (never their name);
  - per task: passed, assisted or failed, the time, and short observations without personal data;
  - the criteria verdicts;
  - the moderator's recommendation.
- **Stored outside the repository, by reference** (location, SHA-256, date), following the evidence rules: consent forms, any recordings, and anything that could identify the participant or their business.
- **Who closes DG-10:** the founder reads the record and takes the DG-10 decision. A session, the moderator or the engineering side never marks DG-10 TAKEN, VERIFIED or COMPLETE.

## 7. Moderator opening script (German)

The full German script, consent text and checklist are in [owner-test/session-kit.md](owner-test/session-kit.md).

> Vielen Dank, dass Sie sich Zeit nehmen. Wir testen heute nicht Sie, sondern einen Entwurf für eine Seite, auf der Betriebe ihre Rückrufe sehen. Alles, was Sie sehen, ist ausgedacht: keine echten Kunden, keine echten Nummern. Bitte sagen Sie laut, was Sie denken, auch wenn etwas unklar ist – gerade das hilft uns. Es gibt keine falschen Antworten. Ich lese Ihnen kurze Aufgaben vor; wenn Sie fertig sind, sagen Sie einfach „fertig“. Darf ich mir dabei Notizen machen?
