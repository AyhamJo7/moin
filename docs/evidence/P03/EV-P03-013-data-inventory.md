# EV-P03-013: Field-level personal-data inventory with roles, retention, method and subprocessor

| Field | Value |
|---|---|
| Evidence ID | EV-P03-013 |
| Item | P03.06.01 |
| Date (UTC) | 2026-09-28 23:13 UTC |
| Commit | `66270cbaae43e1d823fcf5cb6b36caa0117cad59` |
| Environment | local |
| Command / procedure | docs/privacy/data-inventory.md classifies every field across call and conversation, contacts, work, knowledge, AI records, identity and audit, security and billing — at FIELD level rather than category level, because category level is where erasure requests die: "conversation data" cannot be erased, but conversations.caller_number can. Each row carries the category, whether it is personal, the default retention with its configurable bounds, the erasure method (hard delete, anonymise, crypto-erase) and the subprocessor that sees it. The controller/processor split is stated with its operational consequence: a DSAR from a caller goes to the business and we provide tooling; a DSAR from a customer user comes to us. |
| Result | PASS, with four decisions stated rather than smoothed over. conversations.request_text is named as the single riskiest field in the product — free text a caller spoke, capped at 200 characters precisely so it cannot become a transcript by accumulation — and whether it is defensible at all is an open EXT-02 question. Contacts are anonymised rather than deleted, because deleting the root would orphan the tasks and leads referencing it and the shape of history is the business own operational data. Knowledge is flagged as POSSIBLY personal, because an owner writing "bei Notfaellen Herrn Meier anrufen, 0170..." has put a staff member number into a field nobody classified. And German commercial and tax law overrides erasure for billing records for eight years, which is stated plainly because a privacy notice promising unconditional erasure and then failing to deliver it is worse than one that is precise. |
| CI run / artifact | pending |
| Reviewer | pending; every legal question routed to EXT-02 |

Sensitive material is stored by reference only (PLAN.md evidence rules).
