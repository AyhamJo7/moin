# DG-10 owner test: session kit

- **Use with:** the [test plan](../owner-usability-test.md), whose tasks T1–T11 and criteria C1–C8 apply unchanged; the [prototype](README.md); and the [observation sheet](observation-sheet.md).
- **Length:** 20–30 minutes, one participant, one moderator, one note-taker.
- **Founder only:** the session takes place only when the founder has arranged and authorised it, recruited the participant, and approved the consent text below (§3). Nobody runs it on their own initiative.

## 1. Before the session (checklist)

- [ ] **Session authorised.** The founder has authorised this session (date, place, participant) in writing.
- [ ] **Participant qualifies.** The participant is a restaurant **owner** who handles callbacks themselves (test plan §1.3). If the session is also P13's acceptance session, it is the Gurlitt owner.
- [ ] **Consent text approved.** The founder has approved the consent text (§3), including the data-protection details marked "vom Gründer festzulegen". There are two printed copies.
- [ ] **Check passed.** `node docs/design/owner-test/check-prototype.mjs` reports 0 failures on the commit being tested. The commit SHA and file digest are entered on the observation sheet.
- [ ] **Laptop ready:** Chrome or Edge, German locale, zoom 100%, the moderator page open, notifications off.
- [ ] **Phone path tested.** The participant's phone reaches the prototype address (README §3); the moderator has tried it on a second phone.
- [ ] **Dialler tested.** Tapping a number opens the dialler with an invalid fixture number, and the moderator cancels.
- [ ] **No recording** unless the participant agreed to it separately (§3).

## 2. Running order

Phone first, because owners mostly use Heute on a phone and C5 needs an unprompted discovery on each device.

| Block                                               | Task                                           | Device                 | Scenario (moderator page)                    | Minutes |
| --------------------------------------------------- | ---------------------------------------------- | ---------------------- | -------------------------------------------- | ------- |
| Welcome                                             | consent, two warm-up questions (§4)            | —                      | —                                            | 3       |
| A, phone                                            | T3                                             | phone                  | Morgen                                       | 2       |
|                                                     | T5 (phone)                                     | phone                  | Morgen (same tab, continue)                  | 1       |
|                                                     | T6                                             | phone                  | Morgen: the participant activates "Erledigt" | 2       |
|                                                     | T10                                            | phone                  | Volle Liste                                  | 2       |
|                                                     | T7                                             | phone                  | Nichts offen                                 | 1       |
| B, desktop                                          | T1                                             | laptop                 | Volle Liste                                  | 1       |
|                                                     | T2                                             | laptop                 | Volle Liste (continue)                       | 1       |
|                                                     | T4                                             | laptop                 | Volle Liste (continue)                       | 1       |
|                                                     | T5 (desktop)                                   | laptop                 | Morgen                                       | 1       |
|                                                     | T9                                             | laptop                 | Erledigt nicht möglich                       | 1       |
|                                                     | T8                                             | laptop                 | Langsames Laden                              | 1       |
|                                                     | supplementary S1 (not a criterion): read error | laptop                 | Laden fehlgeschlagen                         | 1       |
| Close                                               | closing questions (§6)                         | —                      | —                                            | 3       |
| Optional, only if the founder combined the sessions | T11 (P13 matrix only)                          | as the founder decides | Volle Liste                                  | ≤ 5     |

- **Learning effect:** T5 (desktop) follows T5 (phone), so the desktop result carries the participant's earlier exposure. The observation sheet records that. It changes neither C5 nor its wording.
- **S1** checks the read-error message (DESIGN.md §6). It is recorded as an observation, not as a C1–C8 verdict.

## 3. Consent and privacy (German; for the participant)

The founder adapts the parts marked "vom Gründer festzulegen" before the first session. A data-protection or legal review of this text is the founder's decision.

> **Teilnahme an einem Nutzertest – Information und Einwilligung**
>
> Wir testen einen Entwurf für eine Seite, auf der Betriebe ihre Rückrufe sehen. Getestet wird der Entwurf, nicht Sie.
>
> - Alle Aufgaben, Namen und Telefonnummern im Test sind erfunden. Bitte nennen Sie keine echten Kunden, Nummern oder Betriebsinterna.
> - Die Teilnahme ist freiwillig. Sie können jederzeit ohne Angabe von Gründen abbrechen.
> - Wir machen schriftliche Notizen zu dem, was Sie tun und sagen – ohne Ihren Namen. Ton-, Bild- oder Bildschirmaufnahmen machen wir nur, wenn Sie unten gesondert zustimmen.
> - Die Notizen dienen nur dazu, den Entwurf zu verbessern und eine Produktentscheidung zu belegen. Sie werden außerhalb des Programmcodes gespeichert; aufbewahrt bis _(vom Gründer festzulegen)_; verantwortlich: _(vom Gründer festzulegen)_; Kontakt für Fragen oder Löschung: _(vom Gründer festzulegen)_.
> - Auf Ihrem Telefon öffnen Sie nur eine Testseite im Browser. Es wird nichts installiert, und die Seite sendet nichts. Wenn sich beim Tippen auf eine Nummer die Telefon-App öffnet, brechen Sie bitte ab – es wird niemand angerufen.
>
> ☐ Ich bin mit der Teilnahme und mit schriftlichen Notizen einverstanden.
> ☐ Ich bin zusätzlich mit einer Aufnahme einverstanden: ☐ Ton ☐ Bildschirm (freiwillig).
>
> Ort, Datum, Unterschrift: ______________________

- **Storage:** signed forms and any recordings stay out of the repository. The evidence record refers to them only by location, SHA-256 and date (observation sheet §5).

## 4. Moderator script (German, read verbatim)

**Welcome:**

> Vielen Dank, dass Sie sich Zeit nehmen. Wir testen heute nicht Sie, sondern einen Entwurf für eine Seite, auf der Betriebe ihre Rückrufe sehen. Alles, was Sie sehen, ist ausgedacht: keine echten Kunden, keine echten Nummern. Bitte sagen Sie laut, was Sie denken, auch wenn etwas unklar ist – gerade das hilft uns. Es gibt keine falschen Antworten. Ich lese Ihnen kurze Aufgaben vor; wenn Sie fertig sind, sagen Sie einfach „fertig“. Darf ich mir dabei Notizen machen?

**Warm-up questions** (no personal or customer data):

> Wie erfahren Sie heute, dass jemand zurückgerufen werden möchte?
> Auf welchem Gerät würden Sie so eine Übersicht am ehesten ansehen?

**Rules for the moderator:**

- Read each prompt verbatim. Never say the name of a control, especially not "Erledigt", before the participant has found it.
- Start the stopwatch at the end of the prompt.
- Give a hint only after 60 seconds without progress, and record it: the task is then "mit Hilfe".
- After each task, ask only: „Was haben Sie erwartet?“

## 5. Tasks (prompts from the test plan, unchanged)

| Task           | Prompt (verbatim)                                                                                              | Observe and measure                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| T3             | „Wie würden Sie die Person, die um 08:58 Uhr angerufen hat, jetzt zurückrufen?“                                | time to the tap; did the dialler open with the number? did they then cancel? Never let a call be placed |
| T5 (phone)     | „Sie haben die Person erreicht und alles geklärt. Was machen Sie jetzt hier auf der Seite?“                    | time until they point at or tap "Erledigt" on the 08:58 row; no hint                                    |
| T6             | „Was ist gerade passiert?“ (after activating "Erledigt")                                                       | did they notice "Wird gespeichert …", the outcome notice, and the row leaving the list? their own words |
| T10            | „Finden Sie den Rückruf wegen der Reservierung von gestern Abend um 21:13 Uhr.“                                | time; scrolling path; the right row?                                                                    |
| T7             | „Was sagt Ihnen diese Seite?“                                                                                  | do they say nothing is waiting?                                                                         |
| T1             | „Stellen Sie sich vor, Sie kommen morgens in den Betrieb. Welcher Rückruf ist am dringendsten?“                | time; which row do they point at?                                                                       |
| T2             | „Worum geht es bei diesem Rückruf?“ (on the row from T1, then on "Rückruf: Reservierung für Geburtstagsfeier") | the reason in their own words                                                                           |
| T4             | „Die dringenden Rückrufe sind erledigt. Welcher kommt als Nächstes?“                                           | do they name the first row under "Rückrufe"?                                                            |
| T5 (desktop)   | „Sie haben die Person erreicht und alles geklärt. Was machen Sie jetzt hier auf der Seite?“                    | as on the phone; note the earlier exposure                                                              |
| T9             | „Was können Sie bei dieser Aufgabe tun?“ (on "Rückruf: Reservierung")                                          | do they understand that it isn't possible now and to reload later?                                      |
| T8             | „Was passiert hier gerade?“ (while the placeholder shows)                                                      | do they understand it is loading? do they act on the placeholders?                                      |
| S1             | „Was sagt Ihnen diese Seite?“ (the read-error message)                                                         | supplementary: do they understand the problem and "Neu laden"?                                          |
| T11 (optional) | „Gehen Sie Ihre Aufgaben von heute durch, so wie Sie es morgens tun würden.“                                   | total time, unassisted? Recorded **only** in the P13 matrix                                             |

## 6. Closing questions (German)

> Was war für Sie am klarsten? Was war am wenigsten klar?
> Gab es etwas, das Sie gesucht und nicht gefunden haben?
> Würden Sie diese Seite morgens zwischen zwei Gästen nutzen? Warum (nicht)?

Thank the participant. Close the browser tab on every device, and stop the local server.
