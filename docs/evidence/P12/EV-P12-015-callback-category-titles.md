# EV-P12-015: Founder scope reduction: simulated callback titles are one of four category constants (no guest count, weekday, month or caller words); contact consent denied unless every refusal word is explained by a closed harmless construction, fixing a false refusal from unrelated negation and missed refusals; official mutation KILLED. Local simulator only; supersedes the detail extraction in EV-P12-014; P12.09.01 stays open, nothing VERIFIED.

| Field | Value |
|---|---|
| Evidence ID | EV-P12-015 |
| Item | P12.09.01 |
| Date (UTC) | 2026-10-18 23:03 UTC |
| Commit | `c564c72384bbffd799e31bacee5d36d03e88cb60` |
| Environment | local |
| Command / procedure | see Detail: unit, real-PostgreSQL integration and official mutation commands |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## Detail (PRODUCT-01, PR #242, fifth independent review REQUEST_CHANGES at `009b8ed`)

**Why the scope was narrowed.** Four review rounds (EV-P12-014) kept finding sentences where a guest
count or a day was attributed to the booking although the caller meant the callback, an availability,
an existing booking or a range. Each fix added grammar; each round found new counterexamples. The founder
decided (2026-10-19) that PRODUCT-01 communicates the broad topic only. This is a deliberate reduction of
the feature, not a test bypass: the detail extraction described in EV-P12-014 is removed from the code
and no longer claimed.

**Contract now** (`apps/server/src/modules/call-simulator/application/callback-request.ts`). An accepted
callback is titled with exactly one of four constants, typed as the closed union `CallbackTitle`:

| Title | When |
|---|---|
| `Rückruf: Reservierung` | the request plainly asks about a new reservation (`reservieren`, `Reservierung`, `Tischreservierung`, `Tisch buchen`) |
| `Rückruf: Geburtstagsfeier` | a birthday celebration (`Geburtstagsfeier/-essen/-party`, or `Geburtstag` beside `feiern` in its clause) |
| `Rückruf: Reservierung für Geburtstagsfeier` | both |
| `Rückruf erbeten` | anything else, and every uncertain case |

Uncertain means: a negation, cancellation, change, doubt or alternative (`nicht`, `stornieren`,
`verschieben`, `vielleicht`, `oder`, …); an existing, possessive or past booking (`habe`, `gebucht`,
`meine Reservierung`, `war`, `letzte`); a complaint or booking software (`Problem`, `Beschwerde`,
`funktioniert`, `online`, `App`, `Formular`, `System`, `Reservierungs…` compounds). No title says reserved
or confirmed: a callback request is not a booking. "Tischreservierung" is no longer a separate title.

**Eliminated by construction.** Guest counts, numeric and written ranges, weekdays, months and the
callback-date versus booking-date association are deleted (about 280 lines: `guestCount`, `when`,
`bookingDateSpans`, `GUEST_MENTION`, `NUMBER_WORDS`, `DETAIL_HEDGE`, the weekday and month lists, the
title truncation). `Rückruf: Reservierung für 8 Personen` and `Rückruf: Reservierung am Freitag` cannot be
produced: the interpreter returns only members of `CALLBACK_TITLES`, so the EV-P12-014 F2 and F3 findings
(dates and counts) no longer have an output to be wrong in. F1 (no caller words) holds by the same
construction.

**F4 false refusal (fifth review).** `Bitte um Rückruf denn die Onlinebuchung funktioniert nicht.` was
`unsupported`. Root cause: one refusal pattern accepted up to five arbitrary words between `Rückruf` and a
clause-final `nicht`, so a negation about the booking software was read as refusing the callback.

**Why the correction is structural.** Replacing that window with a closed list of bounded refusal phrases
fixed the false refusal, but a fresh adversarial reviewer (who had not written the code) then found the
opposite failure in three rounds: 76 of 121, 45 of 103 and 34 of 78 new utterances off contract, the
unsafe class being refusals that still created a callback (`Ein Rückruf wäre nicht nötig`, `Rückruf? Ist
nicht nötig.`, `Kein Bedarf an einem Rückruf`, `doch lieber nicht`, `Lieber eine E-Mail`). Any list of
refusal phrases fails toward unwanted contact. A clause-scoped variant (negation counts only in the
clause naming the contact) failed the same way once the refusal moved to its own sentence.

**Correction: consent is denied by default** (`callback-request.ts`, `REFUSAL_WORD`, `HARMLESS`,
`refusalLeft`). Every refusal word anywhere in the utterance (`nicht`, `nichts`, `nie`, `kein…`, `nein`,
`weder`, `erledigt`, `geklärt`, `egal`, `verzichten`, `stornieren`, `vergessen`, `lassen`, `sparen`,
`statt`, `hinfällig`, `zwecklos`, `überholt`, `Versehen`, `wozu`, `schriftlich`, `zurückziehen`, `passt
schon`, `alles gut`, another channel such as `per Mail`, …) must be explained by one of a closed set of
harmless constructions, or the request is unsupported:

- a named thing that fails: determiner, a noun that is not a contact or request word, a fault verb
  (`funktioniert`, `geht`, `lädt`, `klappt`, `kam … an`, …) and the negation: `die Onlinebuchung
  funktioniert nicht`, `das Formular geht nicht`;
- a booking cancelled as the object: `die Reservierung stornieren`, `die Geburtstagsfeier absagen`;
- something the caller does not do: `nicht online reservieren`, `nicht stornieren`, `komme online nicht
  weiter`, `bin morgen nicht erreichbar`, `kann gerade nicht sprechen`;
- a real time limit: a clock time, weekday or daypart after the negation (`nicht vor 18 Uhr`, `kein
  Rückruf morgens`, `nicht am Wochenende`, `nicht zu spät`), never a year or a list that excludes the whole
  day;
- a reminder: `nicht vergessen`, `Vergessen Sie (bitte) den Rückruf nicht`;
- a report of a callback that did not come, in a strict template: `Ich habe keinen Rückruf bekommen`,
  `Sie haben mich nicht zurückgerufen`, `Warum rufen Sie nicht zurück?`;
- set phrases: `keine Eile`, `kein Problem`, `nicht dringend`, `nicht schlimm`, `warum nicht`.

Separately, the caller calling back (`Ich rufe später zurück`, `Ich melde mich selbst`) and a rhetorical
`warum zurückrufen` are refusals. Thanks for a callback, one received (`Ich habe schon einen Rückruf
bekommen`), a report (`Bisher kein Rückruf`), `Rückrufaktion`, `Rückrufnummer` and a bare
`zurückgerufen` are not requests. The grammar's gaps now cost a wanted callback, which the caller can
repeat; they no longer create an unwanted one from a refusal word the grammar knows.

Three classes:

- A, explicit refusal: unsupported, HTTP 422, nothing written.
- B, a positive request whose negation is recognised as harmless (the three founder examples and their
  variants): a callback, with the generic title (the negation also makes the topic uncertain).
- C, contradiction, take-back or any unexplained negation: unsupported. Accepted price: some wanted
  callbacks are lost, for example `Bitte um Rückruf, das klappt bei mir nicht.` (pronoun subject),
  `Bitte um Rückruf, Onlinebuchung funktioniert nicht.` (no determiner), `Ich kann Sie leider nicht
  anrufen, bitte rufen Sie mich zurück.`, `Rückruf bitte, ich weiß noch nicht ob die Geburtstagsfeier
  stattfindet`, `statt Freitag lieber Samstag`. These were callbacks before.

**RED.** At `009b8ed` the new test `Bitte um Rückruf denn die Onlinebuchung funktioniert nicht. →
Rückruf erbeten` failed: `expected { kind: 'unsupported' } to strictly equal { kind: 'callback', title:
'Rückruf erbeten' }`. Each adversarial-round group failed on the design it was found against (recorded
in the test file comments); at the category-only commit (previous refusal block) 118 of 347 unit tests
fail, all refusal, request or consent cases.

**Commits.** `371b156` category-only titles and topic classification (refusal block unchanged);
`c564c72` the deny-by-default consent check; `2208cb6` the category-only property checked against the
founder's four titles written out in the test, not the module's own list. The two fix commits touch
disjoint regions so the official checker can reverse each alone.

**Tests (revised inventory, 348 unit tests in the two simulator files).**

- `callback-request.test.ts`: outcomes (invalid, unsupported, normalisation, the four titles fit the
  72-character bound and the Today contract, pathological input); 20 category cases with positive controls
  for each of the four titles (founder brief and rehearsal sentences included); 8 no-topic cases and 21
  uncertain topics giving the generic title; F1 privacy (9 disclosures, 5 topics outside the vocabulary,
  markup and instructions); 49 explicit refusals (the six founder examples included); 9 contradictions;
  27 positive requests with harmless negation plus a positive control; adversarial round one (34 refusals,
  4 non-requests, 14 kept callbacks); 15 conservative cases (unsupported on purpose); round two (43
  refusals, 7 harmless negations kept); 21 change, cancellation, lost-item or second-booking cases and 3
  positive controls; round three (29 refusals, 4 founder-positive variants, 5 category cases).
- `callback-request.properties.test.ts`: fixed enumerations, no random input. Four bases reach all four
  titles (a classifier answering `Rückruf erbeten` for everything fails); the module's list equals the
  founder's four titles written out in the test; a count and a day stated plainly inside the booking
  phrase (4 pairs × 3 phrasings) never reach the title; appending or prepending 8 count sentences
  (exact, ranges, `fünfzehn bis 20`, `null bis acht`, 100), 13 date sentences or 6 personal disclosures
  leaves every title unchanged; 27 earlier count and date inputs (all earlier reviewer counterexamples)
  give one of the four titles and no digit, count noun, weekday, month or time; adding any of the six
  founder refusals to any base gives unsupported; adding any of five unrelated negations keeps the
  callback.
- Removed expectations, intentionally: every expectation of a detailed title (`… für 6 Personen`,
  `… am Freitag`, `… im Dezember`, `Tischreservierung`) and the tests of count and date attribution
  (their inputs remain as no-detail assertions); earlier callbacks now unsupported are listed in the
  conservative group with the reason.
- Real PostgreSQL (`callback-today.integration.test.ts`, `owner-completes-callback.integration.test.ts`,
  70 tests): the four titles persisted and served on Today, including the reviewer counterexamples and the
  Onlinebuchung sentence; refusals (the six founder examples, earlier ones and a contradiction) each answer
  422 with the `unsupported-request` problem and leave the row count of every public table unchanged, with
  `tasks`, `interaction_outcomes`, `callback_acceptances` and `audit_events` asserted present in the count;
  the positive control shows the same comparison sees one more task, outcome, acceptance and audit event;
  the three founder positives create the callback; J2 replay, completion (M2A), tenant isolation, CSRF and
  restart tests unchanged and passing.

**Official mutation** (`.claude/bin/mutation_check.py`, fix path `callback-request.ts`; each run reverses
one fix commit on the current tree). All KILLED: without the fix exit 1 on business assertions, with it
exit 0, fix restored byte-identical, tree unchanged by the tests.

| Record | Fix reversed | Test | Without fix |
|---|---|---|---|
| `EV-P12-015-mutation-category.json` | `371b156` | unit `category: the topic of the callback` | 21 failed, e.g. `expected 'Rückruf: Reservierung' to be 'Rückruf erbeten'` |
| `EV-P12-015-mutation-category-only.json` | `371b156` | properties `category-only output` | 3 failed, e.g. `expected [ 'Rückruf erbeten', …(3) ] to include 'Rückruf: Reservierung für 8 Personen …'` (one failure is the missing `CALLBACK_TITLES` export) |
| `EV-P12-015-mutation-false-refusal.json` | `c564c72` | unit `a negation that does not target the callback` | 4 failed, `expected { kind: 'unsupported' } to strictly equal { kind: 'callback', … }` |
| `EV-P12-015-mutation-missed-refusal.json` | `c564c72` | unit `adversarial round` | 55 failed |
| `EV-P12-015-mutation-integration-category.json` | `371b156` | PostgreSQL `only the four category titles` | `expected 'Rückruf: Reservierung am Samstag' to be 'Rückruf: Reservierung'` |
| `EV-P12-015-mutation-integration-false-refusal.json` | `c564c72` | PostgreSQL `unrelated negation still creates the callback` | `Bitte um Rückruf denn die Onlinebuchung funktioniert nicht.: expected 422 to be 201` |
| `EV-P12-015-mutation-integration-refusal.json` | `c564c72` | PostgreSQL `a refusal of the callback is 422` | `Bitte zurückrufen, oder lieber doch nicht.: expected 201 to be 422` |

The reversed code is the previous implementation, so each kill shows that the group's tests need the new
behaviour; it does not prove the grammar right for every sentence. The EV-P12-014 mutation records concern
the removed detail extraction and say nothing about this implementation.

**Replay compatibility.** The title is part of the acceptance's request hash (`callback-intake.ts`,
unchanged). A call accepted under earlier rules with a detailed title (for example `Rückruf: Reservierung
für 6 Personen am Freitag` or `Rückruf: Tischreservierung`) and delivered again with the same CallSid and
words now interprets to the category title: the request differs, so the answer is 409
`callback-conflict`, nothing is written, the stored title is not rewritten and no second task is created
(new real-PostgreSQL test). A call whose words are now a refusal gets 422 before the acceptance is
consulted. A replay with the same title is the usual 200 `replayed: true`, also for a completed task.

**Limitations.** Local simulator only: real calls (P12) bring their own summaries under the retention
rules. A finite grammar: the third adversarial round still found refusals phrased without any word the
grammar knows as a refusal (closed in the grammar where cheap; the class cannot be closed by a word list),
so a refusal in vocabulary outside `REFUSAL_WORD` can still create a callback. Consent is denied by default,
so most gaps cost a wanted callback instead (the conservative group lists examples). More than three words
between "ruf" and "zurück" is not recognised as a callback, nor is "Bitte rufen Sie mich an". Topic
classification is a word list too: an existing booking named only by "auf den Namen …" or "Nummer …", or
"die Reservierung meiner Frau", is still titled `Rückruf: Reservierung`. The checks inspect database tables,
not logs. The founder demo still runs the earlier build and shows detailed titles until an approved
rebuild.

**Deferred.** Explicit details (guest count, booking day or month) may return later in P12 only with their
own privacy review, semantic-correctness criteria and integration with the real call pipeline.
