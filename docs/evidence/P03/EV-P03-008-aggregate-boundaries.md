# EV-P03-008: Aggregate boundaries with the rule each holds at every commit

| Field | Value |
|---|---|
| Evidence ID | EV-P03-008 |
| Item | P03.02.03 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | Eleven aggregates, each with its root, contents and the invariant true at every commit. The reasoning for the two contentious boundaries is recorded: Conversation and Task are separate because a task outlives the conversation, can be reassigned and completed days later, and several conversations can feed one — and because a long-running task must not hold a lock on a live call aggregate; the INV-06 rule therefore spans them, which is exactly why a reconciler checks it rather than a database constraint. AppointmentRequest and Appointment are separate because an appointment may exist only after a booking tool returned success (INV-05); collapsing them would permit an appointment nobody booked. |
| Result | PASS |
| CI run / artifact | exact-commit CI, back-filled 2026-10-16 (M0): container-scan success https://github.com/AyhamJo7/moin/actions/runs/36457622050; pr-title success https://github.com/AyhamJo7/moin/actions/runs/36457621863; security-scan success https://github.com/AyhamJo7/moin/actions/runs/36457621910; verify success https://github.com/AyhamJo7/moin/actions/runs/36457621861 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
