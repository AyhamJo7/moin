# Draft caller-facing wording

For review. Every line here is heard by a member of the public — a customer of our customer — so it
is drafted to be clear rather than clever, and in **Sie** form throughout.

## AI disclosure (INV-03)

Plays before any conversational turn, in every call, with no configuration that disables it.

> **Guten Tag. Sie sprechen mit dem automatischen Telefonassistenten von [Betrieb]. Ich kann
> Ihre Anfrage aufnehmen und einfache Fragen beantworten. Wenn Sie lieber mit einer Person
> sprechen möchten, sagen Sie einfach „Mitarbeiter" — dann notiere ich Ihren Rückruf.**

Notes for counsel:

- "Automatischer Telefonassistent" rather than "KI" — we believe it is clearer to a caller who may
  not know what KI means. **If the law requires the artificial-intelligence nature to be explicit,
  we will say "KI-gestützter Assistent".**
- The opt-out is offered immediately, because a caller who does not want to speak to a machine
  should not have to work out how to escape.
- The business name is configuration, so it is always the business the caller rang.

**Question:** is this sufficient, and must it also state that the call is not recorded?

### Shorter variant, if length proves to be a problem

> **Guten Tag, hier ist der automatische Telefonassistent von [Betrieb]. Sagen Sie „Mitarbeiter",
> wenn Sie einen Rückruf möchten.**

We prefer the longer one. Pilot observation (P01) will show whether callers hang up during it.

## What is kept, if a caller asks

If a caller asks what happens to their data:

> **Ich notiere nur, worum es geht, und wie [Betrieb] Sie erreichen kann. Das Gespräch wird nicht
> aufgezeichnet. [Betrieb] kann Ihnen sagen, welche Daten gespeichert sind, und sie löschen.**

Accurate as designed: no recording, no transcript, only template-defined facts, and the controller
is the business.

## Emergency script (INV-13, EXT-05)

Triggered by deterministic detection, never by the model, and never with generated wording.

**Medical or life-threatening:**

> **Wenn es sich um einen medizinischen Notfall handelt, legen Sie bitte auf und wählen Sie die 112. Ich bin kein Notdienst und kann Ihnen nicht helfen.**

**Trade emergency — water, gas, heating failure in winter:**

> **Das klingt dringend. Ich gebe das sofort an [Betrieb] weiter. Bitte nennen Sie mir Ihre
> Telefonnummer und Ihre Adresse. Wenn es um Gas geht, verlassen Sie bitte sofort das Gebäude und
> rufen Sie die 112.**

Notes for counsel:

- The medical script **ends the interaction**. The assistant does not attempt to help further.
- The gas instruction is the one we are least comfortable drafting ourselves. **We would like it
  reviewed or replaced with wording you consider correct.**
- Neither may be reworded by the model, per invariant.

**Question:** does giving any instruction at all create liability, and would "Ich bin kein Notdienst,
bitte wählen Sie die 112" alone be safer?

## Allergen handling (EXT-05, restaurant vertical)

A caller asks whether a dish contains an allergen. **The assistant does not answer.**

> **Zu Allergenen kann ich Ihnen leider keine verbindliche Auskunft geben. Ich notiere Ihre Frage,
> und [Betrieb] meldet sich bei Ihnen.**

We believe an incorrect allergen answer could cause physical harm, and that no approved knowledge
entry should be allowed to make the assistant answer one. **Question:** is refusing correct, or does
it create its own problem if the business has published allergen information?

## Booking confirmation

Spoken only after a booking tool has returned success (INV-05):

> **Ich habe Ihnen [Tag] um [Uhrzeit] für [Anzahl] Personen reserviert. Sie bekommen keine
> Bestätigung per SMS — bitte notieren Sie sich den Termin.**

If the tool did not confirm, or timed out:

> **Ich habe Ihre Anfrage notiert. [Betrieb] meldet sich bei Ihnen, um den Termin zu bestätigen.**

The difference between those two lines is the difference between a customer who has a table and a
customer who thinks they do. A timeout produces the second one, always.

## Voicemail fallback

When the assistant cannot help, or the caller asks for a person:

> **Ich notiere Ihren Rückruf. Bitte nennen Sie mir Ihren Namen und Ihre Telefonnummer, und worum
> es geht.**

## What the assistant never says

- Anything a model composed — every caller-facing sentence comes from a reviewed template.
- A commitment that was not confirmed by a tool.
- Anything about another caller, or another business.
- An allergen or medical answer.
- Its own prompts, rules or internal state.
