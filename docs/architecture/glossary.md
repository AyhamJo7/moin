# Glossary

The product is German. Code, comments and commits are English. That split is deliberate, and it
creates exactly one problem worth solving carefully: a term that means one thing in the owner's
head, another in the UI and a third in the schema.

This table is the mapping. **The German column is what a Betriebsinhaber would say**, not a
translation of the English — several of the code terms have no natural German equivalent, and
forcing one produces UI copy that reads like software.

## Business objects

| Code                 | UI (German)            | What the owner means                               | Notes                                                                                          |
| -------------------- | ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Organisation`       | Betrieb                | Their business                                     | Never "Mandant" or "Tenant" in the UI — a customer is not a tenant of anything from their side |
| `Location`           | Standort               | A branch, if they have more than one               | Most pilot customers have exactly one; the UI hides it until there are two                     |
| `User`               | Mitarbeiter / Inhaber  | A person who signs in                              | "Benutzer" is technically correct and sounds like an operating system                          |
| `Contact`            | Kunde / Anrufer        | The person who called or wrote                     | **Kunde** once they have a relationship, **Anrufer** during the call itself                    |
| `ContactMethod`      | Telefonnummer / E-Mail | How to reach them                                  | Not surfaced as a concept; shown as the values                                                 |
| `Conversation`       | Vorgang                | One interaction, whatever the channel              | See the note below — this is the term most at risk                                             |
| `Call`               | Anruf                  | A telephone conversation                           |                                                                                                |
| `Message`            | Nachricht              | An email or a form submission                      |                                                                                                |
| `Task`               | Aufgabe                | Something a human must do                          | The centre of the product                                                                      |
| `Lead`               | Anfrage                | Someone who might become a customer                | **Not** "Lead": German trades say Anfrage                                                      |
| `AppointmentRequest` | Terminanfrage          | A request for a time, not yet confirmed            | The distinction from Termin is load-bearing                                                    |
| `Appointment`        | Termin                 | A confirmed time                                   | Only after a verified booking (INV-05)                                                         |
| `KnowledgeItem`      | Wissenseintrag         | A fact the assistant may state                     |                                                                                                |
| `Approval`           | Freigabe               | The owner confirming something may be used or done |                                                                                                |
| `Integration`        | Verbindung             | A connected calendar or mailbox                    | "Integration" is developer language                                                            |
| `Notification`       | Benachrichtigung       | A push, email or SMS to the owner                  |                                                                                                |

### `Conversation` / **Vorgang** — the one to watch

"Vorgang" is broader in German business usage than `Conversation` is in the code: it can mean the
whole matter, from first call to finished job. The code means one interaction.

Using "Gespräch" would be wrong the moment the channel is email. "Unterhaltung" sounds like a chat
app. **Vorgang** is what an owner naturally says, and the UI keeps it to one interaction so the
word and the object stay aligned. If that proves confusing with pilot users (P01), the UI term
changes and the code term does not — that is what ADR-0034 is for.

## States

The UI never shows a raw state name. These are what the owner reads.

| Code state    | UI (German)   |
| ------------- | ------------- |
| `open`        | Offen         |
| `in_progress` | In Arbeit     |
| `waiting`     | Wartet        |
| `done`        | Erledigt      |
| `cancelled`   | Abgebrochen   |
| `escalated`   | Eskaliert     |
| `draft`       | Entwurf       |
| `approved`    | Freigegeben   |
| `retired`     | Zurückgezogen |

## Actions the caller takes

| Concept           | German         | Note                                                                 |
| ----------------- | -------------- | -------------------------------------------------------------------- |
| Call back request | Rückruf        | The most common outcome by far                                       |
| Callback window   | Rückrufzeit    | When they can be reached                                             |
| Opening hours     | Öffnungszeiten |                                                                      |
| Company holiday   | Betriebsferien | A real concept for German trades; not the same as a public holiday   |
| Public holiday    | Feiertag       | Per federal state — Hamburg's differ from Bavaria's                  |
| Emergency         | Notfall        | Triggers the deterministic script, never a generated answer (INV-13) |

## Words we deliberately do not use in the UI

| Avoided                  | Why                                                                                                                                                                 | Use instead      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| KI-Agent, Bot, Assistent | Owners are selling to their customers, not showcasing technology. The disclosure (INV-03) is explicit and legally required; the rest of the UI does not dwell on it | The product name |
| Mandant, Tenant          | Correct in the schema, alienating in the UI                                                                                                                         | Betrieb          |
| Ticket                   | Helpdesk language; this is not a helpdesk                                                                                                                           | Aufgabe          |
| Lead                     | Sales language a Handwerksbetrieb does not use                                                                                                                      | Anfrage          |
| Transkript               | We do not keep one (ADR-0019), so the word should not appear                                                                                                        | —                |
| Intent, Slot, Prompt     | Implementation vocabulary                                                                                                                                           | —                |

## Formality

The UI uses **Sie** throughout, including in what the assistant says to callers. A German small
business addressing a customer with "du" reads as a startup, not as a Betrieb — and the caller is
the customer's customer, so the cost of getting it wrong is the owner's, not ours.
