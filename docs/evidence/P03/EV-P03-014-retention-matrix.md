# EV-P03-014: Retention matrix aligned with the blueprint and PLAN privacy engineering

| Field | Value |
|---|---|
| Evidence ID | EV-P03-014 |
| Item | P03.06.02 |
| Date (UTC) | 2026-09-28 23:13 UTC |
| Commit | `66270cbaae43e1d823fcf5cb6b36caa0117cad59` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | Defaults with configurable bounds: call metadata 90 days; structured facts 90 days (30-365); contacts while the business relationship continues, with an inactive review PROMPT after 24 months rather than silent deletion, because only the business knows whether a customer is dormant or seasonal; closed tasks and leads 12 months (3-36); AI technical records 30 days; audit 2 years restricted; security logs 1 year; billing 8 years statutory. Tenant deletion is a lifecycle — 30-day grace, then purge, then a certificate — and the backup interaction is stated rather than avoided: backups are immutable by design, so erasure cannot reach into them, they expire within 35 days plus vault retention, and the deletion ledger records the date the last backup containing the tenant expires. That ledger lives outside the database it records deletions from, because a record of "we deleted this" that is itself deleted proves nothing. |
| Result | PASS as a design position. Seven questions are listed that EXT-02 must settle, including whether crypto-erase plus a two-year bound is an acceptable resolution of erasure against an append-only audit trail (INV-10), and whether the backup-expiry reading holds. Until each is answered the conservative branch holds. |
| CI run / artifact | pending |
| Reviewer | pending; EXT-02 |

Sensitive material is stored by reference only (PLAN.md evidence rules).
