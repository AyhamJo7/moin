# Subprocessor register (draft)

- **Phase:** P04.10.03 · **Becomes the customer-facing register in:** P16.08
- **Status:** **draft** — no DPA has been requested or signed. Every status below is honest.

> A subprocessor register is the document a customer's own data-protection officer reads before
> signing. Its failure mode is not being wrong on the day it is written; it is a provider being
> added in phase P20 and nobody remembering that this file exists.
>
> `scripts/check-subprocessors.ts` therefore ties it to the data-flow diagram: every flow in
> `docs/architecture/data-flow.md` must be accounted for here, either by a party that processes it
> or by an explicit statement that it stays inside our own systems. A new flow that crosses to a
> new provider fails the check until this file names it.

## Status vocabulary

| status           | meaning                                            |
| ---------------- | -------------------------------------------------- |
| `NOT_REQUESTED`  | We have not asked.                                 |
| `REQUESTED`      | Asked, with a date; awaiting the counterparty.     |
| `SIGNED`         | Executed, with a date and where the copy is filed. |
| `NOT_APPLICABLE` | No personal data reaches this party.               |

## Parties

| party                                | role                                                                        | what it processes                                               | region                                                                       | DPA             | flows                      |
| ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------- | -------------------------- |
| Twilio Ireland Limited               | Telephony: call signalling, media, transcription and synthesis              | Caller telephone number, call audio in transit, transcript text | IE1 (Ireland) — **STT/TTS vendors and their regions unconfirmed, P04.10.02** | `NOT_REQUESTED` | F2                         |
| OpenAI Ireland Limited               | Language model: intent and slot extraction                                  | Utterance text, transiently; no identifiers sent with it        | EU data residency project — **not created, EXT-12**                          | `NOT_REQUESTED` | F3, F4                     |
| Amazon Web Services EMEA SARL        | Hosting, database, object storage, secrets, identity, notification delivery | Everything the product stores                                   | eu-central-1 (Frankfurt)                                                     | `NOT_REQUESTED` | F6, F9, F10, F12           |
| Google Ireland Limited               | Calendar, on the tenant's own grant                                         | Appointment times and details                                   | tenant's Workspace region                                                    | `NOT_REQUESTED` | F11                        |
| Microsoft Ireland Operations Limited | Calendar, on the tenant's own grant                                         | Appointment times and details                                   | tenant's Microsoft 365 region                                                | `NOT_REQUESTED` | F11                        |
| _(alternative EU model provider)_    | Contingency language model (DG-14)                                          | As OpenAI                                                       | EU                                                                           | `NOT_REQUESTED` | — (not yet in the diagram) |

## Flows that stay inside our own systems

These cross no party boundary and therefore have no register row. Listed explicitly, because
"absent from the register" and "does not need a register row" must not look the same.

| flow | why no subprocessor                                                 |
| ---- | ------------------------------------------------------------------- |
| F1   | The caller speaking, before anything of ours receives it.           |
| F5   | Our application writing to our own database inside our own account. |
| F7   | The browser to our own load balancer and API.                       |
| F8   | Our API to our own database.                                        |

## What each open item blocks

- **Twilio's written answer (P04.10.02)** — which STT and TTS vendors, in which regions, with what
  retention and what deletion API. Without it the chain above stops at Twilio, and a DPIA that
  stops at the first hop is not a DPIA. It is DG-01 criterion 4.
- **OpenAI EU project (EXT-12)** — until it exists, F3 and F4 have no lawful configured path.
- **DG-14** — the alternative provider becomes a row here the moment it is selected, not when it
  is first used.

## Rules

1. A provider that processes personal data on our behalf gets a row **before** the first call to
   it in any environment, including staging. Staging traffic is test data until someone pastes a
   real telephone number into it.
2. The region cell is where processing happens, not where the company is registered.
3. A DPA that is `REQUESTED` carries the date it was requested. A request with no date is a
   sentence, not a status.
4. This file is derived from the data-flow diagram, never the other way round. If a provider is
   here and no flow reaches it, one of the two documents is wrong.
