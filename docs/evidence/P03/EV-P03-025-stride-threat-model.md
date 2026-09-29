# EV-P03-025: STRIDE per component and flow, with every mitigation bound to a checklist item

| Field | Value |
|---|---|
| Evidence ID | EV-P03-025 |
| Item | P03.05.01 |
| Date (UTC) | 2026-09-28 23:33 UTC |
| Commit | `be50961f50af79cd9f515f5b2916876ad67bbcb3` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/security/threat-model.md covers voice, api, worker, web and support access, the data store, the provider boundary, ingestion, tenant context outside PostgreSQL, the tenant as attacker, and supply chain — 63 mitigations, each bound to a PLAN checklist item and each item verified to exist and relate by scripts/check-threat-model-refs.ts. It opens by naming what an attacker actually wants here, which is what decides which threats matter: competitor intelligence, fraud setup, disruption, toll fraud, and — most likely and most damaging — the OAuth tokens to customers calendars and mailboxes, which are worth more than anything in our own database. |
| Result | PASS after the independent review (EV-P03-024) found and forced the correction of 2 Critical and 7 High findings. The document now carries 11 residual risks rather than 6; a threat model with no residual risk has not been done honestly, and three of the added ones say uncomfortable things: prompt injection is bounded and never eliminated, our model provider is an insider to every conversation, and our telephony provider is an insider to every call. |
| CI run / artifact | pending |
| Reviewer | security-reviewer agent; founder review pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
