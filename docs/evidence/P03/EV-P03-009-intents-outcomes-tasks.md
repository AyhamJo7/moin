# EV-P03-009: Canonical intents, outcome codes and task types as closed vocabularies (T-01)

| Field | Value |
|---|---|
| Evidence ID | EV-P03-009 |
| Item | P03.02.04 |
| Date (UTC) | 2026-09-28 23:09 UTC |
| Commit | `906b56850bb346db6642e094b217e86640696239` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | 16 intents, 11 outcome codes, 10 task types, each closed and each an enum in packages/contracts so adding one changes a reviewed schema. Two design points are recorded with their reasons: unknown is a first-class intent rather than a failure, because a caller whose intent did not classify is still a customer and the correct behaviour is to take a message; and failed_technical ALWAYS produces a task, because a technical failure must never look to the owner like nothing happened (INV-19). The document also fixes the ordering that keeps a model from deciding a booking occurred: the model produces only the intent, the dialogue manager decides the outcome from what actually happened including whether a tool succeeded, and the task follows from the outcome (INV-05). |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
