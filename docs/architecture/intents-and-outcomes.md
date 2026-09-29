# Canonical intents, outcome codes and task types

Three closed vocabularies (T-01). Closed on purpose: each is a value the dialogue manager branches
on, an eval asserts against, and a report groups by. An open set of strings would make all three
unreliable within a month.

Adding a value is a product decision with a template and an eval case, not a string literal.

## Canonical intents

What the caller wants. The model maps an utterance to one of these; a vertical template declares
which it enables (ADR-0026).

| Intent                  | German shape                              | Enabled by default for                |
| ----------------------- | ----------------------------------------- | ------------------------------------- |
| `booking_request`       | "Haben Sie Donnerstag noch was frei?"     | restaurant                            |
| `booking_change`        | "Ich muss meine Reservierung verschieben" | restaurant                            |
| `booking_cancel`        | "Ich muss leider absagen"                 | restaurant                            |
| `service_request`       | "Meine Heizung ist ausgefallen"           | handwerk                              |
| `quote_request`         | "Was würde ein neues Bad kosten?"         | handwerk                              |
| `opening_hours`         | "Wann haben Sie heute auf?"               | all                                   |
| `location_directions`   | "Wo genau finde ich Sie?"                 | all                                   |
| `price_question`        | "Was kostet das Mittagsmenü?"             | all                                   |
| `availability_question` | "Sind Sie nächste Woche im Urlaub?"       | all                                   |
| `callback_request`      | "Können Sie mich zurückrufen?"            | all                                   |
| `message_for_owner`     | "Sagen Sie ihm bitte, dass…"              | all                                   |
| `existing_matter`       | "Ich rufe wegen meines Termins an"        | all                                   |
| `emergency`             | "Bei mir steht das Wasser im Keller"      | handwerk (deterministic path, INV-13) |
| `complaint`             | "Ich war da und es war zu"                | all                                   |
| `spam_or_sales`         | A cold sales call                         | all                                   |
| `unknown`               | Nothing matched with confidence           | all                                   |

`unknown` is a first-class intent, not a failure. It routes to a callback task with whatever was
captured — the caller is still a customer, and the correct behaviour is to take a message rather
than to keep guessing.

`emergency` never reaches the model's response path. Detection is deterministic and the wording is
a reviewed script (ADR-0039).

## Outcome codes

How the interaction ended. Every finalised conversation has exactly one (INV-06).

| Outcome                   | Meaning                                | Produces a task?              |
| ------------------------- | -------------------------------------- | ----------------------------- |
| `answered_from_knowledge` | Fully answered from approved knowledge | no                            |
| `booking_confirmed`       | A booking tool returned success        | no                            |
| `booking_requested`       | Wanted a time; needs the owner         | yes                           |
| `callback_requested`      | Asked to be called back                | yes                           |
| `message_taken`           | Left a message                         | yes                           |
| `lead_captured`           | New enquiry worth following up         | yes                           |
| `emergency_routed`        | Emergency script ran and escalated     | yes                           |
| `transferred`             | Handed to a human during the call      | depends                       |
| `caller_hung_up`          | Ended before the purpose was clear     | yes, if anything was captured |
| `spam_rejected`           | Identified as sales or spam            | no                            |
| `failed_technical`        | The system could not complete the call | **yes, always** (INV-19)      |

`failed_technical` always produces a task. A technical failure must never look like nothing
happened: the owner has to know someone tried to reach them and did not get through.

## Task types

What the owner has to do. Each has a default priority and a default escalation window; a tenant may
adjust the window, not invent a type (INV-18).

| Task type               | Default urgency                                   |
| ----------------------- | ------------------------------------------------- |
| `call_back`             | normal                                            |
| `confirm_booking`       | high — the caller is waiting on an answer         |
| `answer_question`       | normal                                            |
| `follow_up_lead`        | normal                                            |
| `handle_emergency`      | **immediate** — escalation chain, not a list item |
| `review_complaint`      | high                                              |
| `approve_knowledge`     | low                                               |
| `reconnect_integration` | high — silent failure degrades everything else    |
| `review_failed_call`    | high                                              |
| `review_ai_uncertainty` | normal                                            |

## How the three relate

```text
utterance ──model──► intent ──dialogue manager──► outcome ──┬──► task (type, urgency)
                       │                                     └──► no task, if the outcome is terminal
                       └─ unknown ──────────────────────────────► callback_request + call_back task
```

The model produces only the **intent**. The outcome is decided by the dialogue manager from what
actually happened — including whether a tool succeeded — and the task follows from the outcome.
That ordering is what keeps a model from being able to decide that a booking happened (INV-05).

## Verification

| Enforcement                                       | Where                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The three sets stay closed                        | Enums in `packages/contracts`; adding one changes a reviewed schema                |
| Every outcome maps to a defined task rule         | Table-driven test over the full outcome set                                        |
| `failed_technical` always produces a task         | Failure-injection test: kill the call mid-dialogue, assert a task exists (INV-19)  |
| `emergency` never reaches the model response path | Deterministic path test; the emergency eval suite must show zero failures (INV-13) |
| Intent classification stays accurate              | AI evaluation suite with per-intent minimum N (P12, LG-V gates)                    |
