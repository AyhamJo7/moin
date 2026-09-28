# EV-P02-042: ARCHITECTURE.md linking the ADRs, and SECURITY.md

| Field | Value |
|---|---|
| Evidence ID | EV-P02-042 |
| Item | P02.07.02 |
| Date (UTC) | 2026-09-28 16:55 UTC |
| Commit | `1867d75a2e18138a222de269ed7909a2b196a9b3` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | ARCHITECTURE.md: what the system is, the role/image shape with INV-17 stated, module boundaries and how they are enforced, a table linking ADR-0002, ADR-0034, ADR-0035 and ADR-0036, the invariants that most shape the architecture, the package map, and an explicit "not built yet" section pointing at the Status Ledger. SECURITY.md: private-advisory reporting, what data the product actually handles, and the controls that carry the weight — tenant isolation, secrets, personal data in telemetry, AI boundaries, audit, supply chain, and the runtime image — each with the failure it prevents rather than a restatement of the control. |
| Result | PASS. SECURITY.md ends with a plainly stated list of what is NOT yet in place: no production environment, no external penetration test, no formal privacy review, and branch protection not yet active. A security document that presents intentions as facts is worse than none. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
