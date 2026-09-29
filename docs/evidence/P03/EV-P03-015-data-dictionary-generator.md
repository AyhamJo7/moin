# EV-P03-015: Data-dictionary check: no column holding personal data is unclassified

| Field | Value |
|---|---|
| Evidence ID | EV-P03-015 |
| Item | P03.06.03 |
| Date (UTC) | 2026-09-28 23:13 UTC |
| Commit | `66270cbaae43e1d823fcf5cb6b36caa0117cad59` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | scripts/check-data-classification.ts parses CREATE TABLE statements out of the migrations, skips constraints, and fails on any column the inventory has never seen unless it is on a deliberately narrow structural list (keys, timestamps, tenant scope). organisation_id is structural because it identifies a BUSINESS, not a person; anything that could name, locate or contact a human is not on that list. 6 unit tests, including a fixture migration containing an unclassified personal column. |
| Result | PASS — and proven non-vacuous, which mattered here: the real schema has only five columns today, so a bare pass would have shown nothing. The fixture proves the check flags contacts.secret_nickname while accepting contacts.display_name, which the inventory does classify, and treats id, organisation_id and created_at as structural. Once Drizzle table definitions exist in P06 the check reads those instead, which is stricter because it sees types. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
