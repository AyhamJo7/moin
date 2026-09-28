# Personal-data inventory and retention matrix

Field level, because category level is where erasure requests go to die: "conversation data" cannot
be erased, but `conversations.caller_number` can.

**Nothing here is a legal conclusion.** This describes product behaviour designed to _support_
compliance. Every legal question is routed to EXT-02, and the open ones are listed at the end.

## Roles

| Processing                                                                      | Our role                                                                | Why                                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Caller data, contacts, conversations, tasks, knowledge containing personal data | **Processor** for the customer business                                 | The business decides why and how; we process on their instruction under an AVV (Art. 28) |
| Customer account data — users, billing, support, fraud prevention, analytics    | **Controller**                                                          | Our own purposes, our own privacy notice                                                 |
| Platform security logs                                                          | **Controller** for security; processor where they contain customer data | Legitimate interest in securing the service                                              |

The split matters operationally, not just legally: a DSAR from a _caller_ goes to the business,
and we provide the tooling. A DSAR from a _customer's user_ comes to us.

## How to read the columns

- **Category** — the unit retention and erasure operate on.
- **Legal basis (processor context)** — the customer's basis, which we support rather than assert.
- **Retention** — the default, and the bounds a customer may configure within.
- **Method** — `hard delete`, `anonymise` (identifying fields cleared, row kept), or `crypto-erase`.
- **Subprocessor** — who else sees it.

## Inventory

### Call and conversation

| Field                                         | Category        | Personal?                            | Retention                            | Method      | Subprocessor                    |
| --------------------------------------------- | --------------- | ------------------------------------ | ------------------------------------ | ----------- | ------------------------------- |
| — (raw audio)                                 | Call audio      | **yes**                              | **never stored** (INV-07)            | n/a         | Twilio, transient only          |
| `calls.caller_number`                         | Call metadata   | yes (E.164)                          | 90 d                                 | hard delete | Twilio                          |
| `calls.caller_number_presented`               | Call metadata   | no (boolean)                         | 90 d                                 | hard delete | —                               |
| `calls.started_at`, `ended_at`, `duration_ms` | Call metadata   | no alone, identifying in combination | 90 d                                 | hard delete | Twilio                          |
| `calls.outcome_code`                          | Call metadata   | no                                   | 90 d                                 | hard delete | —                               |
| `call_events.type`, `at`                      | Call metadata   | no                                   | 90 d                                 | hard delete | —                               |
| `conversations.request_text` (≤ 200 chars)    | Structured fact | **yes, free text**                   | 90 d (30–365)                        | hard delete | OpenAI (transient, no training) |
| `conversations.intent`, `slots`               | Structured fact | yes, depends on slot                 | 90 d (30–365)                        | hard delete | OpenAI (transient)              |
| _turn log_                                    | Transient STT   | **yes**                              | **not stored by default** (ADR-0019) | n/a         | —                               |

`conversations.request_text` is the single riskiest field in the product: free text a caller spoke,
capped at 200 characters. It is capped precisely so it cannot become a transcript by accumulation,
and **whether it is defensible at all is an open EXT-02 question**.

### Contacts

| Field                                  | Category | Personal?          | Retention                                 | Method      | Subprocessor |
| -------------------------------------- | -------- | ------------------ | ----------------------------------------- | ----------- | ------------ |
| `contacts.display_name`                | Contact  | **yes**            | while the business relationship continues | anonymise   | —            |
| `contacts.notes`                       | Contact  | **yes, free text** | same                                      | hard delete | —            |
| `contact_methods.value` (phone, email) | Contact  | **yes**            | same                                      | hard delete | —            |
| `contact_methods.normalised`           | Contact  | yes (derived)      | same                                      | hard delete | —            |
| `contacts.created_at`, `last_seen_at`  | Contact  | no alone           | same                                      | anonymise   | —            |
| `contact_merges.*`                     | Contact  | yes (references)   | 24 months after the merge                 | hard delete | —            |

Anonymise rather than delete for the contact root: deleting it would orphan the tasks and leads that
reference it, and the _shape_ of history — how many enquiries, over what period — is the business's
own operational data, not the caller's personal data.

`contacts` has an **inactive review prompt after 24 months**: the owner is asked, rather than the
data being deleted silently, because only the business knows whether a customer is dormant or
seasonal.

### Work

| Field                                    | Category    | Personal?          | Retention                      | Method      | Subprocessor             |
| ---------------------------------------- | ----------- | ------------------ | ------------------------------ | ----------- | ------------------------ |
| `tasks.title`, `description`             | Task        | **yes, free text** | 12 months after closure (3–36) | hard delete | —                        |
| `tasks.state`, `type`, `due_at`          | Task        | no                 | same                           | hard delete | —                        |
| `notes.body`                             | Task        | **yes, free text** | same                           | hard delete | —                        |
| `leads.*`                                | Lead        | yes (references)   | 12 months after closure (3–36) | hard delete | —                        |
| `appointment_requests.requested_windows` | Appointment | no                 | 12 months                      | hard delete | —                        |
| `appointments.*`                         | Appointment | yes (references)   | 12 months                      | hard delete | Google / Microsoft (P20) |

### Knowledge

| Field                        | Category  | Personal?                                     | Retention                  | Method      | Subprocessor        |
| ---------------------------- | --------- | --------------------------------------------- | -------------------------- | ----------- | ------------------- |
| `knowledge_items.content`    | Knowledge | **possibly** — owner-authored, may name staff | while approved             | hard delete | OpenAI (embeddings) |
| `knowledge_chunks.embedding` | Knowledge | derived                                       | while the item is approved | hard delete | OpenAI (transient)  |
| `business_profile.*`         | Business  | no (company data)                             | while the tenant exists    | hard delete | —                   |

Knowledge is flagged **possibly** personal on purpose. An owner writing "bei Notfällen Herrn Meier
anrufen, 0170…" has put a staff member's number into a field nobody classified as personal. The
approval step (INV-08) is where that is caught, and the approval UI says so.

### AI records

| Field                                         | Category     | Personal?           | Retention | Method      | Subprocessor |
| --------------------------------------------- | ------------ | ------------------- | --------- | ----------- | ------------ |
| `ai_actions.proposed_output`                  | AI technical | **yes** (redacted)  | 30 d      | hard delete | —            |
| `ai_actions.prompt_version`, `policy_version` | AI technical | no                  | 30 d      | hard delete | —            |
| `tool_invocations.arguments`                  | AI technical | **yes** (sanitised) | 30 d      | hard delete | —            |

### Identity, audit and security

| Field                                       | Category                 | Personal?            | Retention                       | Method                | Subprocessor |
| ------------------------------------------- | ------------------------ | -------------------- | ------------------------------- | --------------------- | ------------ |
| `users.email`                               | Account (**controller**) | yes                  | while the account exists + 30 d | hard delete           | AWS Cognito  |
| `users.cognito_subject`                     | Account                  | pseudonymous         | same                            | hard delete           | AWS Cognito  |
| `sessions.*`                                | Account                  | yes (IP, user agent) | 30 d after expiry               | hard delete           | —            |
| `audit_events.actor_id`, `operation`        | Audit                    | pseudonymous         | **2 years, restricted**         | **crypto-erase only** | —            |
| `audit_events.arguments`                    | Audit                    | sanitised            | 2 years                         | crypto-erase only     | —            |
| Security logs (IP, user agent, auth events) | Security                 | yes                  | 1 year                          | hard delete           | AWS          |

**The audit trail is append-only by construction (INV-10)** — there is no update or delete path.
That is a deliberate tension with erasure, and the resolution is crypto-erase plus the two-year
bound. **EXT-02 must confirm it**: the design position is that the integrity of an audit trail is
itself a legal obligation, and that a pseudonymous actor reference inside it is proportionate.

### Billing

| Field                                 | Category                 | Personal?    | Retention                    | Method           | Subprocessor |
| ------------------------------------- | ------------------------ | ------------ | ---------------------------- | ---------------- | ------------ |
| `subscriptions.*`, `billing_events.*` | Account (**controller**) | yes          | **8 years** (HGB/AO, EXT-08) | none — statutory | Stripe       |
| `usage_ledger.*`                      | Account                  | pseudonymous | 8 years                      | none — statutory | —            |

German commercial and tax law requires retention here, and it **overrides an erasure request** for
these records. That is stated plainly because a privacy notice that promises unconditional erasure
and then cannot deliver it is worse than one that is precise.

## Subprocessors

| Subprocessor       | What it sees                                        | Region             | Basis                                |
| ------------------ | --------------------------------------------------- | ------------------ | ------------------------------------ |
| AWS                | Everything at rest and in transit                   | eu-central-1       | AVV; EU region                       |
| Twilio             | Caller number, call timing, audio in transit        | EU where available | AVV; **EXT-11**                      |
| OpenAI             | Utterance text, transiently, for NLU and embeddings | EU project         | AVV, no-training headers; **EXT-12** |
| Stripe             | Billing contact and payment data                    | EU                 | AVV                                  |
| Google / Microsoft | Calendar and mailbox contents, on connection        | per tenant         | tenant-granted OAuth                 |

Every entry is an open external gate until the AVV is signed. None may be claimed as in place.

## Tenant deletion

`terminating → (30-day grace) → purging → deleted`, then a certificate.

Live data is erased at purge. **Backups are immutable by design** (ADR-0038), so erasure cannot
reach into them; they expire within 35 days plus the backup-vault retention, and the deletion
ledger records the date the last backup containing the tenant expires.

That ledger lives **outside** the database it records deletions from — a record of "we deleted this"
that is itself deleted proves nothing.

## What EXT-02 must settle

1. Is `conversations.request_text` at 200 characters a template-defined fact, or a transcript
   fragment?
2. Is the optional redacted turn log lawful on controller instruction, and what must the AVV say?
3. Is crypto-erase plus a two-year bound an acceptable resolution of erasure against an append-only
   audit trail?
4. Does the backup-expiry position hold — erasure applied to live data immediately, to backups by
   expiry, with the ledger recording the date?
5. Does telecom confidentiality (TKG) add obligations beyond the GDPR for answering calls on a
   business's behalf?
6. Do the default retention periods above hold, and are the configurable bounds defensible?
7. What exactly must a caller be told, and when (INV-03)?

**Until these are answered, the conservative branch holds in every case.**

## Verification

| Enforcement                                     | Where                                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No column holding personal data is unclassified | `scripts/check-data-classification.ts` against this inventory (P03.06.04, then QG-12)                                                          |
| Every category has an erasure handler           | Compile-time registry; a module without one does not build (ADR-0018)                                                                          |
| Retention is applied                            | Retention engine sweep, alarmed on age (P16)                                                                                                   |
| No raw audio is ever written                    | Storage assertion in the voice path (INV-07)                                                                                                   |
| Subprocessor list matches reality               | Every outbound provider call goes through an adapter in `packages/integrations`; a new provider is a boundary-rule change and a register entry |
