# DG-10 owner test: observation sheet (template)

Copy this sheet for each session. Fill it in during and right after the session. **Write only what the participant actually did or said.** Never fill in an expected result, and leave empty what wasn't observed. No names, customer data or business details go on this sheet (§5).

## 1. Session header

| Field                                                                                                | Entry            |
| ---------------------------------------------------------------------------------------------------- | ---------------- |
| Date, start and end time                                                                             |                  |
| Session authorised by the founder (date, form)                                                       |                  |
| Moderator / note-taker (roles, not names)                                                            |                  |
| Participant's role: restaurant **owner** who handles callbacks themselves? (yes/no)                  |                  |
| Counts as DG-10 evidence (only if the line above is "yes")                                           |                  |
| Also P13's session? (founder decision; Gurlitt owner?)                                               |                  |
| Consent: notes / audio / screen (each yes or no)                                                     |                  |
| Phone-access approval in the DG-10 record (date, approved values), or "none: phone tasks not tested" |                  |
| Only with an approved phone route: server start and stop times, and what happened to its log         |                  |
| Prototype version (`data-version`)                                                                   | DG-10-Prototyp 1 |
| Commit SHA tested                                                                                    |                  |
| SHA-256 of the prototype files and `proposal.css` (README §4)                                        |                  |
| `check-prototype.mjs` result on that SHA (failures, date)                                            |                  |
| Laptop: browser and version, window width, zoom                                                      |                  |
| Phone: model class, OS, browser, text size setting                                                   |                  |
| Order actually run, and any deviation from the kit                                                   |                  |

## 2. Per task

Outcome is one of: **bestanden** (unassisted, within the time in the criterion), **mit Hilfe** (a hint was given), **nicht bestanden**, or **nicht getestet** (give the reason).

| Task               | Device / scenario               | Time from the end of the prompt (s) | Outcome | Hint given? At (s) | First tap or click went to | Observation, quote (no personal data) | Findings (ID, severity) |
| ------------------ | ------------------------------- | ----------------------------------- | ------- | ------------------ | -------------------------- | ------------------------------------- | ----------------------- |
| T3                 | phone / Morgen                  |                                     |         |                    |                            |                                       |                         |
| T5 phone           | phone / Morgen                  |                                     |         |                    |                            |                                       |                         |
| T6                 | phone / Morgen                  |                                     |         |                    |                            |                                       |                         |
| T10                | phone / Volle Liste             |                                     |         |                    |                            |                                       |                         |
| T7                 | phone / Nichts offen            |                                     |         |                    |                            |                                       |                         |
| T1                 | laptop / Volle Liste            |                                     |         |                    |                            |                                       |                         |
| T2                 | laptop / Volle Liste            |                                     |         |                    |                            |                                       |                         |
| T4                 | laptop / Volle Liste            |                                     |         |                    |                            |                                       |                         |
| T5 desktop         | laptop / Morgen                 |                                     |         |                    |                            | (earlier exposure on the phone: yes)  |                         |
| T9                 | laptop / Erledigt nicht möglich |                                     |         |                    |                            |                                       |                         |
| T8                 | laptop / Langsames Laden        |                                     |         |                    |                            |                                       |                         |
| S1 (supplementary) | laptop / Laden fehlgeschlagen   |                                     |         |                    |                            |                                       |                         |

## 3. DG-10 criteria matrix

These are the criteria of the [test plan](../owner-usability-test.md) §5, unchanged. A verdict comes only from the rows in §2.

| Criterion                                                                           | Task(s)               | Verdict (bestanden / nicht bestanden / nicht getestet) | Basis (task row, time) |
| ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | ---------------------- |
| C1 the most urgent callback found within 10 s, unassisted                           | T1                    |                                                        |                        |
| C2 the reason for the call stated from the title, unassisted                        | T2                    |                                                        |                        |
| C3 the phone dialler opened with the caller's number from the call link, unassisted | T3                    |                                                        |                        |
| C4 the next callback in order named correctly                                       | T4                    |                                                        |                        |
| **C5 "Erledigt" found without prompting within 10 s, on phone and on desktop**      | T5 phone + T5 desktop |                                                        |                        |
| C6 completion understood                                                            | T6                    |                                                        |                        |
| C7 empty, loading and unavailable states understood                                 | T7, T8, T9            |                                                        |                        |
| C8 the phone layout navigated, unassisted                                           | T10                   |                                                        |                        |

**What this session can't show:** the real application's persistence, sign-in, live updates, recovery or browser integration. "Erledigt" was simulated in the browser tab.

## 4. P13 acceptance matrix (separate; only if the founder combined the sessions)

| P13 acceptance criterion                                                                                                             | Entry                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Owner usability session with the Gurlitt owner: they complete the morning review of 10 synthetic items in < 5 minutes without help" |                                                                                                                                                     |
| Participant is the Gurlitt owner (yes/no)                                                                                            |                                                                                                                                                     |
| T11: total time; any help?                                                                                                           |                                                                                                                                                     |
| Run on                                                                                                                               | the prototype (a simulation), **not** the implemented Heute                                                                                         |
| Counts toward P13 acceptance?                                                                                                        | **founder decision.** A prototype run doesn't satisfy it automatically, and P13's other acceptance evidence (E2E, axe on the real app) is untouched |

## 5. Findings severity

| Severity    | Meaning                                                                                     | Example                                                                  |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 4, blocking | a core task fails, or the participant believes something false that leads to a wrong action | thinks a callback is done when it isn't; can't find any way to call back |
| 3, serious  | the task succeeds only with a hint, or takes more than twice the criterion's time           | finds "Erledigt" only after a hint                                       |
| 2, moderate | visible hesitation or a wrong first try, then recovers alone                                | first taps the title, then finds the number                              |
| 1, minor    | a remark or preference with no effect on the task                                           | "the grey is a bit pale"                                                 |

Each finding gets an ID (F1, F2, …), the task, the severity, what was observed, and the screen it happened on. Recommendations are kept apart from observations.

## 6. Where the evidence goes (proposal; the founder confirms)

- **In the repository**, as an evidence record created with `python3 .claude/bin/evidence.py new --phase P13 --item P13.01.04 …`. The proposed item is P13.01.04, the item PLAN ties to DG-10 ("Design tokens (DG-10)"). The record holds this sheet with no personal data, the commit SHA and the digest. PLAN's EV-P13-003 is already used by another record, so the record gets the next free ID.
- **Outside the repository, by reference only** (location, SHA-256, date): signed consent forms, any recordings, and anything that could identify the participant or their business.
- **Not in the record:** names, phone numbers other than the fixtures, customer details, or quotes that identify the business.
- **Afterwards:** the founder reads the record and decides DG-10. Neither the session nor the record changes DG-10's status.
