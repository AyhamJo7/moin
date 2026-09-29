# EV-P03-006: German/English glossary mapping UI terms to code terms

| Field | Value |
|---|---|
| Evidence ID | EV-P03-006 |
| Item | P03.02.01 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` |
| Environment | local |
| Command / procedure | docs/architecture/glossary.md maps every business object, state and caller action between the code term and what a Betriebsinhaber would actually say — the German column is what an owner says, not a translation, because several code terms have no natural German equivalent and forcing one produces UI copy that reads like software. It also records the words deliberately NOT used in the UI (Mandant, Ticket, Lead, Transkript, Bot, and the implementation vocabulary of intents, slots and prompts) with the reason for each, and fixes Sie as the form of address throughout including in what the assistant says to callers. |
| Result | PASS. One term is flagged as genuinely at risk rather than settled: Vorgang is broader in German business usage than Conversation is in the code — an owner may mean the whole matter from first call to finished job. The alternatives are worse (Gespräch is wrong the moment the channel is email; Unterhaltung sounds like a chat app), so the UI keeps Vorgang to one interaction and P01 pilot observation decides whether that holds. If it does not, the UI term changes and the code term does not, which is what ADR-0034 exists for. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
