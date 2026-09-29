# EV-P03-012: Ten state machines as transition tables with a property-test plan

| Field | Value |
|---|---|
| Evidence ID | EV-P03-012 |
| Item | P03.03.01 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | docs/architecture/state-machines.md specifies the call session, interaction finalisation, task, lead, appointment request, knowledge item, integration, tenant lifecycle, DSAR request and support access grant — each as a transition table where a blank cell is a REJECTED transition rather than an undefined one. That distinction is the point: a machine written as if-statements has no blank cells, only paths nobody wrote. The call session carries its five deadlines as numbers with the reason for each (silence past about four seconds reads as disconnection). Six property tests are specified, generated from the tables rather than hand-listed, the first being that every transition not in the table is rejected. |
| Result | PASS. Two states exist deliberately and are documented as such: degraded in the call session, because a provider error mid-dialogue must fall back to a deterministic script rather than hang up on a customer mid-sentence; and orphaned in interaction finalisation, because a conversation that reaches finalising without an outcome or a task is exactly what INV-06 forbids, and pretending it cannot happen would mean not detecting it. The tenant lifecycle permits terminating to active but not purging to active: accidentally terminating a live business must be recoverable, and deletion after the grace period must be real. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
