# EV-P03-026: Abuse cases: what will actually be tried, including the tenant as attacker

| Field | Value |
|---|---|
| Evidence ID | EV-P03-026 |
| Item | P03.05.02 |
| Date (UTC) | 2026-09-28 23:33 UTC |
| Commit | `be50961f50af79cd9f515f5b2916876ad67bbcb3` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | Seven abuse cases rather than STRIDE categories: social engineering over the phone ("Ich bin der Inhaber"), competitor knowledge scraping, toll-fraud-like traffic, malicious knowledge entry, notification spam as harassment, support-access abuse, and — added after the review — the tenant as attacker. |
| Result | PASS, and two of these were corrected by the review rather than written correctly first. The notification-spam mitigation contained its own bypass: "caps, with escalation preserved for genuinely urgent items" leaves the uncapped channel reachable from the untrusted side, because a caller decides urgency by uttering an emergency trigger — escalation now has its own independent ceiling and repeated claims are surfaced rather than suppressed, since suppressing them would violate INV-13. And toll fraud was modelled only on the inbound leg when the monetisable one is outbound: the caller supplies the callback number that the owner later dials. The tenant-as-attacker case was missing entirely, which for self-serve software that answers a telephone in a business name is the wrong assumption to have made. |
| CI run / artifact | pending |
| Reviewer | security-reviewer agent; founder review pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
