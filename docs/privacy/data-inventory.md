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

### Tenancy

The customer's own business details, held as controller data about our customer rather than as
processor data about their callers. A business address is not personal data; a sole trader's
business address is their home address, and the distinction is not one the schema can make. So it
is treated as personal throughout, which costs nothing and avoids a judgement call per row.

| Field                                            | Category | Personal?                                                       | Retention                                       | Method      | Subprocessor               |
| ------------------------------------------------ | -------- | --------------------------------------------------------------- | ----------------------------------------------- | ----------- | -------------------------- |
| `organisations.slug`                             | Account  | no (chosen identifier, may embed a surname)                     | life of the contract + 8 y\*                    | hard delete | —                          |
| `organisations.status`                           | Account  | no                                                              | life of the contract + 8 y\*                    | hard delete | —                          |
| `organisations.time_zone`                        | Account  | no                                                              | life of the contract                            | hard delete | —                          |
| `organisations.early_access`                     | Account  | no                                                              | life of the contract                            | hard delete | —                          |
| `organisations.plan_code`                        | Account  | no                                                              | life of the contract + 8 y\*                    | hard delete | —                          |
| `tenant_setup.template_ref`                      | Account  | no                                                              | life of the contract                            | hard delete | —                          |
| `tenant_setup.retention_days`                    | Account  | no                                                              | life of the contract                            | hard delete | —                          |
| `tenant_setup.settings`                          | Account  | no at provisioning (`{}`); future keys require reclassification | life of the contract                            | hard delete | —                          |
| `owner_invitation_requests.email`                | Account  | yes                                                             | until invitation resolved or tenant termination | hard delete | mail provider after P06.08 |
| `owner_invitation_requests.state`                | Account  | no                                                              | same                                            | hard delete | —                          |
| `provisioning_limits.early_access_cap`           | Platform | no                                                              | permanent audit history                         | retain      | —                          |
| `provisioning_limits.accepted_paid_early_access` | Platform | no                                                              | permanent audit history                         | retain      | —                          |
| `provisioning_limits.reason`                     | Platform | no                                                              | permanent audit history                         | retain      | —                          |
| `provisioning_requests.request_id`               | Account  | no (random request identifier)                                  | life of the contract                            | hard delete | —                          |
| `provisioning_requests.tenant_id`                | Account  | no (business identifier)                                        | life of the contract                            | hard delete | —                          |
| `locations.street`, `postal_code`, `city`        | Account  | **yes for a sole trader** — see above                           | life of the contract                            | hard delete | —                          |
| `locations.country_code`                         | Account  | no                                                              | life of the contract                            | hard delete | —                          |
| `locations.time_zone`                            | Account  | no                                                              | life of the contract                            | hard delete | —                          |

\* Billing-relevant fields are retained for eight years under German tax law (GoBD/HGB, EXT-08),
which overrides erasure for those records. The rest is deleted on tenant termination.

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

| Field                                        | Category | Personal?                                                     | Retention                                 | Method      | Subprocessor |
| -------------------------------------------- | -------- | ------------------------------------------------------------- | ----------------------------------------- | ----------- | ------------ |
| `contacts.display_name`                      | Contact  | **yes**                                                       | while the business relationship continues | anonymise   | —            |
| `contacts.notes`                             | Contact  | **yes, free text**                                            | same                                      | hard delete | —            |
| `contact_methods.value` (phone, email)       | Contact  | **yes**                                                       | same                                      | hard delete | —            |
| `contact_methods.contact_id`                 | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `contact_methods.kind`                       | Contact  | yes in combination (what channel reaches the person)          | same                                      | hard delete | —            |
| `contact_methods.verification`               | Contact  | no alone (workflow state about the value, not the person)     | same                                      | hard delete | —            |
| `contact_methods.verified_via`               | Contact  | no alone (how confirmation happened, not who was confirmed)   | same                                      | hard delete | —            |
| `contact_methods.is_tenant_owned`            | Contact  | no (about the business's own number, not a caller)            | same                                      | hard delete | —            |
| `contact_methods.normalised`                 | Contact  | yes (derived)                                                 | same                                      | hard delete | —            |
| `contacts.created_at`, `last_seen_at`        | Contact  | no alone                                                      | same                                      | anonymise   | —            |
| `interaction_links.interaction_ref`          | Contact  | yes in combination (which interaction identified whom)        | same                                      | hard delete | —            |
| `interaction_links.contact_id`               | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `interaction_links.method_id`                | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `interaction_links.rule`                     | Contact  | no alone (which channel matched, not who)                     | same                                      | hard delete | —            |
| `interaction_links.label_de`                 | Contact  | no alone (fixed label catalogue, no free text)                | same                                      | hard delete | —            |
| `duplicate_candidates.contact_a_id`          | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.contact_b_id`          | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.kind`                  | Contact  | yes in combination (what channel is shared)                   | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.value`                 | Contact  | **yes** (the shared verified value itself)                    | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.status`                | Contact  | no alone (review workflow state)                              | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.review_task_id`        | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.signal_name`           | Contact  | **yes** (normalised display name)                             | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.signal_postal`         | Contact  | yes in combination (PLZ with name)                            | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.signal_local`          | Contact  | **yes** (email local part)                                    | 24 months after the merge                 | hard delete | —            |
| `duplicate_candidates.ai_suggested`          | Contact  | no alone (boolean flag)                                       | 24 months after the merge                 | hard delete | —            |
| `contact_merges.winner_id`                   | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.loser_id`                    | Contact  | yes (references, row deleted)                                 | 24 months after the merge                 | hard delete | —            |
| `contact_merges.approved_by`                 | Contact  | yes (staff user reference)                                    | 24 months after the merge                 | hard delete | —            |
| `contact_merges.candidate_id`                | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_method_ids`            | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_link_ids`              | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_conversation_ids`      | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_call_ids`              | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_task_ids`              | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_lead_ids`              | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_request_ids`           | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.moved_note_ids`              | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |
| `contact_merges.merged_at`                   | Contact  | no alone (merge timestamp)                                    | 24 months after the merge                 | hard delete | —            |
| `contact_merges.unmerged_at`                 | Contact  | no alone (undo timestamp)                                     | 24 months after the merge                 | hard delete | —            |
| `contact_merges.undone`                      | Contact  | no alone (boolean flag)                                       | 24 months after the merge                 | hard delete | —            |
| `conversations.channel`                      | Contact  | no alone (which channel, not who)                             | same                                      | hard delete | —            |
| `conversations.contact_id`                   | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `conversations.status`                       | Contact  | no alone (workflow state)                                     | same                                      | hard delete | —            |
| `calls.conversation_id`                      | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `calls.provider_call_sid`                    | Contact  | yes in combination (which provider call reached whom)         | same                                      | hard delete | —            |
| `calls.contact_id`                           | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `calls.status`                               | Contact  | no alone (workflow state)                                     | same                                      | hard delete | —            |
| `calls.from_number`                          | Contact  | **yes** (caller number)                                       | same                                      | hard delete | —            |
| `calls.to_number`                            | Contact  | **yes** (dialled number)                                      | same                                      | hard delete | —            |
| `call_events.call_id`                        | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `call_events.kind`                           | Contact  | no alone (event catalogue, no free text)                      | same                                      | hard delete | —            |
| `call_events.detail`                         | Contact  | no alone (opaque int marker)                                  | same                                      | hard delete | —            |
| `messages.conversation_id`                   | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `messages.thread_ref`                        | Contact  | yes in combination (which thread belongs to whom)             | same                                      | hard delete | —            |
| `interaction_outcomes.conversation_id`       | Contact  | yes (references)                                              | same                                      | hard delete | —            |
| `interaction_outcomes.result_code`           | Contact  | no alone (closed result catalogue)                            | same                                      | hard delete | —            |
| `interaction_outcomes.template_intent`       | Contact  | no alone (template name, NULL until P10)                      | same                                      | hard delete | —            |
| `interaction_outcomes.facts_schema_version`  | Contact  | no alone (schema version tag)                                 | same                                      | hard delete | —            |
| `interaction_outcomes.facts`                 | Contact  | **yes, free JSONB** (validated payload about the interaction) | same                                      | hard delete | —            |
| `interaction_outcomes.handled_automatically` | Contact  | no alone (boolean flag)                                       | same                                      | hard delete | —            |
| `contact_merges.*`                           | Contact  | yes (references)                                              | 24 months after the merge                 | hard delete | —            |

Anonymise rather than delete for the contact root: deleting it would orphan the tasks and leads that
reference it, and the _shape_ of history — how many enquiries, over what period — is the business's
own operational data, not the caller's personal data.

`contacts` has an **inactive review prompt after 24 months**: the owner is asked, rather than the
data being deleted silently, because only the business knows whether a customer is dormant or
seasonal.

### Work

| Field                                                                                            | Category    | Personal?                                                             | Retention                      | Method      | Subprocessor             |
| ------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------- | ------------------------------ | ----------- | ------------------------ |
| `tasks.title`, `description`                                                                     | Task        | **yes, free text**                                                    | 12 months after closure (3–36) | hard delete | —                        |
| `tasks.state`, `type`, `due_at`                                                                  | Task        | no                                                                    | same                           | hard delete | —                        |
| `notes.body`                                                                                     | Task        | **yes, free text**                                                    | same                           | hard delete | —                        |
| `leads.*`                                                                                        | Lead        | yes (references)                                                      | 12 months after closure (3–36) | hard delete | —                        |
| `leads.title`                                                                                    | Lead        | **yes, free text** (what the opportunity is about, may name a caller) | same                           | hard delete | —                        |
| `leads.status`, `leads.lost_reason`                                                              | Lead        | no — fixed catalogue values (what stage/why lost, not whom)           | same                           | hard delete | —                        |
| `leads.task_id`, `leads.contact_id`, `leads.conversation_id`                                     | Lead        | yes (references)                                                      | same                           | hard delete | —                        |
| `lead_tasks.lead_id`, `lead_tasks.task_id`                                                       | Lead        | yes (references)                                                      | same                           | hard delete | —                        |
| `notes.contact_id`, `notes.task_id`, `notes.lead_id`                                             | Note        | yes (references)                                                      | 12 months after closure (3–36) | hard delete | —                        |
| `notes.author_user_id`                                                                           | Note        | pseudonymous (who wrote it)                                           | same                           | hard delete | —                        |
| `notes.body` (dedicated table)                                                                   | Note        | **yes, free text**                                                    | same                           | hard delete | —                        |
| `notes.deleted_at`                                                                               | Note        | no — workflow state (hidden, not whom)                                | same                           | hard delete | —                        |
| `fact_schemas.template`, `fact_schemas.version`                                                  | Facts       | no — registry catalogue (which template/version, not whom)            | permanent versioned registry   | retain      | —                        |
| `fact_schemas.schema`, `fact_schemas.labels_de`                                                  | Facts       | no — validation shapes and German labels, no personal data            | permanent versioned registry   | retain      | —                        |
| `appointment_requests.requested_windows`                                                         | Appointment | no                                                                    | 12 months                      | hard delete | —                        |
| `appointment_requests.kind`, `appointment_requests.status`                                       | Appointment | no — fixed catalogue values (what kind/stage, not whom)               | same                           | hard delete | —                        |
| `appointment_requests.contact_id`, `appointment_requests.conversation_id`                        | Appointment | yes (references)                                                      | same                           | hard delete | —                        |
| `appointment_requests.confirmed_by`                                                              | Appointment | pseudonymous (which staff confirmed)                                  | same                           | hard delete | —                        |
| `appointment_requests.informed_via`                                                              | Appointment | no — fixed channel catalogue (how told, not whom)                     | same                           | hard delete | —                        |
| `appointment_requests.window`, `appointment_requests.party_size`, `appointment_requests.service` | Appointment | yes in combination (when/how many/what for — the request itself)      | same                           | hard delete | —                        |
| `appointment_requests.notes`                                                                     | Appointment | **yes, free text**                                                    | same                           | hard delete | —                        |
| `appointment_requests.converted_to_booking_ref`                                                  | Appointment | yes in combination (opaque external handover reference)               | same                           | hard delete | —                        |
| `appointments.*`                                                                                 | Appointment | yes (references)                                                      | 12 months                      | hard delete | Google / Microsoft (P20) |

### Knowledge

| Field                                                                                                  | Category  | Personal?                                            | Retention                  | Method                  | Subprocessor        |
| ------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------- | -------------------------- | ----------------------- | ------------------- |
| `knowledge_items.state`                                                                                | Knowledge | no alone (lifecycle state)                           | while the tenant exists    | hard delete             | —                   |
| `knowledge_items.live_version_id`                                                                      | Knowledge | yes (references)                                     | while the tenant exists    | hard delete             | —                   |
| `knowledge_versions.title`                                                                             | Knowledge | **possibly** — owner-authored, may name staff        | while approved             | hard delete             | OpenAI (embeddings) |
| `knowledge_versions.body`                                                                              | Knowledge | **possibly** — owner-authored, may name staff        | while approved             | hard delete             | OpenAI (embeddings) |
| `knowledge_versions.source`                                                                            | Knowledge | no alone (fixed catalogue)                           | while approved             | hard delete             | —                   |
| `knowledge_versions.location_id`                                                                       | Knowledge | yes (references)                                     | while approved             | hard delete             | —                   |
| `knowledge_versions.category`                                                                          | Knowledge | no alone (owner taxonomy)                            | while approved             | hard delete             | —                   |
| `knowledge_versions.valid_from`, `knowledge_versions.valid_until`                                      | Knowledge | no alone (dates)                                     | while approved             | hard delete             | —                   |
| `knowledge_versions.sensitivity`                                                                       | Knowledge | no alone (fixed catalogue)                           | while approved             | hard delete             | —                   |
| `knowledge_versions.allowed_channels`                                                                  | Knowledge | no alone (fixed catalogue)                           | while approved             | hard delete             | —                   |
| `knowledge_versions.last_verified_at`                                                                  | Knowledge | no alone (timestamp)                                 | while approved             | hard delete             | —                   |
| `knowledge_versions.reverify_after`                                                                    | Knowledge | no alone (interval)                                  | while approved             | hard delete             | —                   |
| `knowledge_items.suspended`                                                                            | Knowledge | no alone (boolean flag)                              | while approved             | hard delete             | —                   |
| `knowledge_items.conflict_state`                                                                       | Knowledge | no alone (conflict flag)                             | while approved             | hard delete             | —                   |
| `knowledge_conflicts.detector`                                                                         | Knowledge | no alone (fixed catalogue)                           | until resolved             | hard delete             | —                   |
| `knowledge_conflicts.detected_at`                                                                      | Knowledge | no alone (timestamp)                                 | until resolved             | hard delete             | —                   |
| `knowledge_conflicts.subject_kind`, `knowledge_conflicts.subject_a`, `knowledge_conflicts.subject_b`   | Knowledge | yes (references)                                     | until resolved             | hard delete             | —                   |
| `knowledge_conflicts.reason`                                                                           | Knowledge | no alone (detector marker)                           | until resolved             | hard delete             | —                   |
| `knowledge_conflicts.status`, `knowledge_conflicts.resolved_at`, `knowledge_conflicts.resolution_note` | Knowledge | **possibly** — owner-authored note                   | until resolved             | hard delete             | —                   |
| `knowledge_conflicts.task_id`                                                                          | Knowledge | yes (references)                                     | until resolved             | hard delete             | —                   |
| `knowledge_versions.item_id`                                                                           | Knowledge | yes (references)                                     | while approved             | hard delete             | —                   |
| `knowledge_versions.version_no`                                                                        | Knowledge | no alone (monotonic counter)                         | while approved             | hard delete             | —                   |
| `knowledge_versions.state`                                                                             | Knowledge | no alone (lifecycle state)                           | while approved             | hard delete             | —                   |
| `knowledge_approvals.item_id`                                                                          | Knowledge | yes (references)                                     | while the tenant exists    | hard delete             | —                   |
| `knowledge_approvals.version_id`                                                                       | Knowledge | yes (references)                                     | while the tenant exists    | hard delete             | —                   |
| `knowledge_approvals.approved_at`                                                                      | Knowledge | no alone (timestamp)                                 | while the tenant exists    | hard delete             | —                   |
| `knowledge_approvals.approved_by`                                                                      | Knowledge | yes (staff user reference)                           | while the tenant exists    | hard delete             | —                   |
| `knowledge_approvals.approver_role`                                                                    | Knowledge | no (fixed catalogue owner                            | admin)                     | while the tenant exists | hard delete         | —   |
| `knowledge_approvals.version_hash`                                                                     | Knowledge | derived (sha256 of approved payload)                 | while the tenant exists    | hard delete             | —                   |
| `knowledge_approvals.decided_at`                                                                       | Knowledge | no alone (timestamp)                                 | while the tenant exists    | hard delete             | —                   |
| `knowledge_items.content`                                                                              | Knowledge | **possibly** — owner-authored, may name staff        | while approved             | hard delete             | OpenAI (embeddings) |
| `knowledge_chunks.embedding`                                                                           | Knowledge | derived                                              | while the item is approved | hard delete             | OpenAI (transient)  |
| `business_profile.category`                                                                            | Business  | no (fixed catalogue)                                 | while the tenant exists    | hard delete             | —                   |
| `business_profile.name`                                                                                | Business  | **possibly** — sole proprietor trading name          | while the tenant exists    | hard delete             | —                   |
| `business_profile.phonetic_name`                                                                       | Business  | **possibly** — sole proprietor trading name          | while the tenant exists    | hard delete             | —                   |
| `business_profile.street`                                                                              | Business  | **possibly** — home address for sole proprietors     | while the tenant exists    | hard delete             | —                   |
| `business_profile.postal_code`                                                                         | Business  | **possibly** — home address for sole proprietors     | while the tenant exists    | hard delete             | —                   |
| `business_profile.city`                                                                                | Business  | **possibly** — home address for sole proprietors     | while the tenant exists    | hard delete             | —                   |
| `business_profile.body`                                                                                | Business  | **possibly** — owner-authored directions/policy text | while the tenant exists    | hard delete             | —                   |
| `business_profile.services`                                                                            | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.area_postcodes`                                                                      | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.area_radius_km`                                                                      | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.area_center_plz`                                                                     | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.price_label`                                                                         | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.price_min_cents`                                                                     | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.price_max_cents`                                                                     | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `business_profile.price_currency`                                                                      | Business  | no (company data)                                    | while the tenant exists    | hard delete             | —                   |
| `faq_cards.canonical`                                                                                  | Knowledge | **possibly** — owner-authored, may name staff        | while active               | hard delete             | —                   |
| `faq_cards.variants`                                                                                   | Knowledge | **possibly** — caller phrasings, may name staff      | while active               | hard delete             | —                   |
| `faq_cards.spoken_answer`                                                                              | Knowledge | **possibly** — owner-authored, may name staff        | while active               | hard delete             | —                   |
| `faq_cards.written_answer`                                                                             | Knowledge | **possibly** — owner-authored, may name staff        | while active               | hard delete             | —                   |
| `faq_cards.sensitivity`                                                                                | Knowledge | no alone (fixed catalogue)                           | while active               | hard delete             | —                   |
| `faq_cards.allowed_channels`                                                                           | Knowledge | no alone (fixed catalogue)                           | while active               | hard delete             | —                   |
| `faq_cards.location_id`                                                                                | Knowledge | yes (references)                                     | while active               | hard delete             | —                   |
| `faq_cards.active`                                                                                     | Knowledge | no alone (boolean flag)                              | while the tenant exists    | hard delete             | —                   |
| `faq_cards.valid_until`                                                                                | Knowledge | no alone (date)                                      | while active               | hard delete             | —                   |
| `faq_cards.reverify_after`                                                                             | Knowledge | no alone (interval)                                  | while active               | hard delete             | —                   |
| `knowledge_reverify_queue.item_id`                                                                     | Knowledge | yes (references)                                     | until re-approved          | hard delete             | —                   |
| `knowledge_reverify_queue.task_id`                                                                     | Knowledge | yes (references)                                     | until re-approved          | hard delete             | —                   |
| `knowledge_reverify_queue.card_id`                                                                     | Knowledge | yes (references)                                     | until card updated         | hard delete             | —                   |
| `business_domains.domain`                                                                              | Knowledge | no (company domain)                                  | while the tenant exists    | hard delete             | —                   |
| `business_domains.verified_at`                                                                         | Knowledge | no alone (timestamp)                                 | while the tenant exists    | hard delete             | —                   |
| `knowledge_import_runs.source_url`                                                                     | Knowledge | no alone (business url)                              | while the tenant exists    | hard delete             | —                   |
| `knowledge_import_runs.verified_domain`                                                                | Knowledge | no alone (company domain)                            | while the tenant exists    | hard delete             | —                   |
| `knowledge_import_runs.status`                                                                         | Knowledge | no alone (fixed catalogue)                           | while the tenant exists    | hard delete             | —                   |
| `knowledge_import_runs.refusal_reason`                                                                 | Knowledge | no alone (marker)                                    | while the tenant exists    | hard delete             | —                   |
| `knowledge_import_runs.draft_item_ids`                                                                 | Knowledge | yes (references)                                     | while the tenant exists    | hard delete             | —                   |
| `knowledge_versions.import_flagged`                                                                    | Knowledge | no alone (boolean flag)                              | while approved             | hard delete             | —                   |
| `knowledge_versions.import_source_url`                                                                 | Knowledge | no alone (business url)                              | while approved             | hard delete             | —                   |
| `opening_rules.location_id`                                                                            | Business  | yes (references)                                     | while the tenant exists    | hard delete             | —                   |
| `opening_rules.weekday`                                                                                | Business  | no (fixed catalogue 0..6)                            | while the tenant exists    | hard delete             | —                   |
| `opening_rules.opens_min`                                                                              | Business  | no (wall-clock minutes)                              | while the tenant exists    | hard delete             | —                   |
| `opening_rules.closes_min`                                                                             | Business  | no (wall-clock minutes)                              | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.location_id`                                                                       | Business  | yes (references)                                     | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.kind`                                                                              | Business  | no (fixed catalogue)                                 | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.start_date`                                                                        | Business  | no (dates)                                           | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.end_date`                                                                          | Business  | no (dates)                                           | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.opens_min`                                                                         | Business  | no (wall-clock minutes)                              | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.closes_min`                                                                        | Business  | no (wall-clock minutes)                              | while the tenant exists    | hard delete             | —                   |
| `opening_exceptions.label`                                                                             | Business  | **possibly** — owner-authored holiday/vacation label | while the tenant exists    | hard delete             | —                   |

P09.10 (migration 0061) adds no stored columns or new personal-data categories. The existing
`knowledge_versions.allowed_channels` and `faq_cards.allowed_channels` catalogues now accept
`call`, `message`, `voice`, `email`, and `web`. Legacy grants remain literal, not aliases; existing
approved scopes are never widened. New unspecified scopes default to all five channels. Retrieval
without a channel requires all five. `app.knowledge_channel` is transaction-local retrieval context,
not stored business data; the security-invoker approved view enforces it under tenant FORCE RLS.
Sensitivity, retention, erasure, and subprocessors are unchanged.

P08.01 (migration 0062) adds the `job_runs` envelope ledger. Payloads are ID-only references;
the ledger carries routing and bookkeeping, never content.

| Field                                               | Category | Personal?                                 | Retention | Method      | Subprocessor |
| --------------------------------------------------- | -------- | ----------------------------------------- | --------- | ----------- | ------------ |
| `job_runs.type`, `job_runs.queue_name`              | Platform | no — fixed workload catalogue and queue   | 30 d      | hard delete | SQS          |
| `job_runs.version`, `job_runs.attempt`              | Platform | no — counters                             | 30 d      | hard delete | —            |
| `job_runs.correlation_id`, `job_runs.trace_context` | Platform | pseudonymous (links runs across services) | 30 d      | hard delete | —            |
| `job_runs.not_before`                               | Platform | no — a schedule derived from creation     | 30 d      | hard delete | —            |
| `job_runs.payload`                                  | Platform | yes (references) — ID-only row references | 30 d      | hard delete | —            |
| `job_runs.status`                                   | Platform | no — fixed run state                      | 30 d      | hard delete | —            |
| `job_runs.error_code`                               | Platform | no — fixed error catalogue                | 30 d      | hard delete | —            |
| `job_runs.claimed_at`, `job_runs.finished_at`       | Platform | no alone (timestamps)                     | 30 d      | hard delete | —            |

P08.02 (migration 0063) adds the `outbox` table. Same shape as the ledger:
ID-only references plus dispatch bookkeeping, never content.

| Field                                            | Category | Personal?                                 | Retention | Method      | Subprocessor |
| ------------------------------------------------ | -------- | ----------------------------------------- | --------- | ----------- | ------------ |
| `outbox.aggregate`, `outbox.event_type`          | Platform | no — fixed domain catalogue and event     | 30 d      | hard delete | SQS          |
| `outbox.aggregate_id`                            | Platform | yes (references) — the domain row         | 30 d      | hard delete | —            |
| `outbox.aggregate_ver`                           | Platform | no — monotonic per-aggregate counter      | 30 d      | hard delete | —            |
| `outbox.payload`                                 | Platform | yes (references) — ID-only row references | 30 d      | hard delete | —            |
| `outbox.attempts`                                | Platform | no — counter                              | 30 d      | hard delete | —            |
| `outbox.next_attempt_at`, `outbox.dispatched_at` | Platform | no alone (timestamps)                     | 30 d      | hard delete | —            |

P08.03 (migration 0064) adds the `provider_inbox` table. Pre-tenant by design
(ADR-0007): events land before tenant resolution, so the row carries the
provider's identifiers, not ours. Payload retention 30 days.

| Field                                                      | Category | Personal?                                             | Retention | Method      | Subprocessor |
| ---------------------------------------------------------- | -------- | ----------------------------------------------------- | --------- | ----------- | ------------ |
| `provider_inbox.provider`                                  | Platform | no — fixed provider catalogue (which sender)          | 30 d      | hard delete | provider     |
| `provider_inbox.provider_event_id`                         | Platform | pseudonymous (the provider's event reference)         | 30 d      | hard delete | provider     |
| `provider_inbox.resolved_org`                              | Platform | pseudonymous (links the event to a tenant)            | 30 d      | hard delete | —            |
| `provider_inbox.payload`                                   | Platform | **possibly** — provider-shaped, minimised at handling | 30 d      | hard delete | provider     |
| `provider_inbox.status`                                    | Platform | no — fixed inbox state                                | 30 d      | hard delete | —            |
| `provider_inbox.poison_reason`                             | Platform | no — fixed error catalogue text                       | 30 d      | hard delete | —            |
| `provider_inbox.received_at`, `provider_inbox.resolved_at` | Platform | no alone (timestamps)                                 | 30 d      | hard delete | —            |

P08.04 (migration 0065) adds the `idempotency_keys` table. The request body is
never stored — only its SHA-256 — and the stored response replays 24 h
(expires_at is the retention hook).

| Field                           | Category | Personal?                                         | Retention | Method      | Subprocessor |
| ------------------------------- | -------- | ------------------------------------------------- | --------- | ----------- | ------------ |
| `idempotency_keys.operation`    | Platform | no — fixed operation catalogue                    | 24 h      | hard delete | —            |
| `idempotency_keys.key`          | Platform | pseudonymous (client-supplied request reference)  | 24 h      | hard delete | —            |
| `idempotency_keys.request_hash` | Platform | no — SHA-256 of the body, never the body (INV-12) | 24 h      | hard delete | —            |
| `idempotency_keys.response`     | Platform | **possibly** — stored mutation result, minimised  | 24 h      | hard delete | —            |
| `idempotency_keys.status`       | Platform | no — fixed key state                              | 24 h      | hard delete | —            |
| `idempotency_keys.expires_at`   | Platform | no — a deadline derived from creation             | 24 h      | hard delete | —            |

P08.07 (migration 0067) adds the `timers` table. Rows are schedule
bookkeeping — what fires when — never content.

| Field                | Category | Personal?                              | Retention         | Method      | Subprocessor |
| -------------------- | -------- | -------------------------------------- | ----------------- | ----------- | ------------ |
| `timers.kind`        | Platform | no — fixed timer catalogue             | until done + 30 d | hard delete | —            |
| `timers.ref_id`      | Platform | yes (references) — the row to act on   | until done + 30 d | hard delete | —            |
| `timers.due_at`      | Platform | no — a schedule derived from creation  | until done + 30 d | hard delete | —            |
| `timers.lease_until` | Platform | no — sweep bookkeeping, never identity | until done + 30 d | hard delete | —            |
| `timers.attempts`    | Platform | no — counter                           | until done + 30 d | hard delete | —            |
| `timers.done_at`     | Platform | no — a completion timestamp            | until done + 30 d | hard delete | —            |

P08.08 (migration 0068) adds the `sse_events` replay window. Rows are fan-out
bookkeeping — who gets what type — with ID-only payloads, never content.

| Field                   | Category | Personal?                                 | Retention | Method      | Subprocessor |
| ----------------------- | -------- | ----------------------------------------- | --------- | ----------- | ------------ |
| `sse_events.user_id`    | Platform | pseudonymous (links the event to a user)  | 15 min    | hard delete | Valkey       |
| `sse_events.event_id`   | Platform | no — monotonic stream counter             | 15 min    | hard delete | —            |
| `sse_events.event_type` | Platform | no — fixed event catalogue                | 15 min    | hard delete | —            |
| `sse_events.payload`    | Platform | yes (references) — ID-only row references | 15 min    | hard delete | —            |

Knowledge is flagged **possibly** personal on purpose. An owner writing "bei Notfällen Herrn Meier
anrufen, 0170…" has put a staff member's number into a field nobody classified as personal. The
approval step (INV-08) is where that is caught, and the approval UI says so.

### AI records

| Field                                                             | Category     | Personal?                                                     | Retention | Method      | Subprocessor |
| ----------------------------------------------------------------- | ------------ | ------------------------------------------------------------- | --------- | ----------- | ------------ |
| `ai_actions.proposed_output`                                      | AI technical | **yes** (redacted)                                            | 30 d      | hard delete | —            |
| `ai_actions.prompt_version`, `policy_version`                     | AI technical | no                                                            | 30 d      | hard delete | —            |
| `tool_invocations.arguments`                                      | AI technical | **yes** (sanitised)                                           | 30 d      | hard delete | —            |
| `workflow_runs.conversation_id`                                   | Governance   | yes (references)                                              | 30 d      | hard delete | —            |
| `workflow_runs.status`                                            | Governance   | no — fixed run state (what stage, not whom)                   | 30 d      | hard delete | —            |
| `ai_actions.workflow_run_id`, `ai_actions.conversation_id`        | Governance   | yes (references)                                              | 30 d      | hard delete | —            |
| `ai_actions.kind`, `ai_actions.status`                            | Governance   | no — closed catalogues (what step/outcome, never prompt text) | 30 d      | hard delete | —            |
| `tool_invocations.ai_action_id`, `tool_invocations.actor_user_id` | Governance   | pseudonymous (which action/person invoked)                    | 30 d      | hard delete | —            |
| `tool_invocations.tool_name`                                      | Governance   | no — tool catalogue name (what ran, never args)               | 30 d      | hard delete | —            |
| `tool_invocations.state`                                          | Governance   | no — fixed outcome state                                      | 30 d      | hard delete | —            |
| `human_approvals.ai_action_id`                                    | Governance   | yes (references)                                              | 30 d      | hard delete | —            |
| `human_approvals.proposal_kind`                                   | Governance   | no — closed catalogue (what was proposed, never payload)      | 30 d      | hard delete | —            |
| `human_approvals.status`                                          | Governance   | no — fixed decision state                                     | 30 d      | hard delete | —            |
| `human_approvals.decided_by`, `human_approvals.decided_at`        | Governance   | pseudonymous (who decided, when)                              | 30 d      | hard delete | —            |

### Identity, audit and security

| Field                                                                                         | Category                 | Personal?                                                                                                                           | Retention                                                                                                                                                                                                      | Method                                                                                        | Subprocessor |
| --------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------ |
| `users.email`                                                                                 | Account (**controller**) | yes                                                                                                                                 | while the account exists + 30 d                                                                                                                                                                                | hard delete                                                                                   | AWS Cognito  |
| `users.cognito_sub`                                                                           | Account                  | pseudonymous (the provider's subject)                                                                                               | same                                                                                                                                                                                                           | hard delete                                                                                   | AWS Cognito  |
| `users.status`                                                                                | Account                  | no                                                                                                                                  | same                                                                                                                                                                                                           | hard delete                                                                                   | —            |
| `sessions.token_hash`, `family_id`, `rotated_from`                                            | Account                  | no alone — a digest of a random token and opaque session ids                                                                        | 30 d after expiry                                                                                                                                                                                              | hard delete; retention handler pending P16                                                    | —            |
| `sessions.user_id`                                                                            | Account                  | pseudonymous (links to `users`)                                                                                                     | 30 d after expiry                                                                                                                                                                                              | hard delete; retention handler pending P16                                                    | —            |
| `sessions.rotation_reason`, `revocation_reason`                                               | Account                  | no                                                                                                                                  | 30 d after expiry                                                                                                                                                                                              | hard delete; retention handler pending P16                                                    | —            |
| `sessions.last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `step_up_at` | Account                  | yes in combination with `user_id` (when a person was active, incl. last MFA proof)                                                  | 30 d after expiry                                                                                                                                                                                              | hard delete; retention handler pending P16                                                    | —            |
| `sessions.provider_tokens_sealed`, `provider_tokens_key_id`                                   | Account (**controller**) | yes — the sealed ID token carries the subject and email; AES-256-GCM ciphertext                                                     | until the session is revoked (wiped then; moved to the successor on rotation); a session that expires without being revoked keeps them until its row is hard-deleted 30 d after expiry (P16 retention handler) | set to NULL at revocation; hard delete with the row; key retirement crypto-erases (P05.08.01) | AWS Cognito  |
| `auth_transactions.state_hash`, `binding_hash`, `nonce_hash`                                  | Security                 | no — digests of random values                                                                                                       | deleted on use; at most 10 min                                                                                                                                                                                 | hard delete on callback or on the next sign-in after expiry                                   | —            |
| `auth_transactions.verifier_sealed`, `key_id`, `expires_at`                                   | Security                 | no — a sealed random PKCE verifier                                                                                                  | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `auth_transactions.return_to`, `step_up_session_id`                                           | Security                 | no — an internal application path, validated at sign-in start, plus the opaque session id being re-verified (NULL for plain logins) | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `memberships.organisation_id`, `memberships.user_id`                                          | Account                  | pseudonymous (links a person to a tenant)                                                                                           | 30 d after the membership ends                                                                                                                                                                                 | hard delete with the row                                                                      | —            |
| `memberships.role`, `memberships.permissions`, `memberships.status`                           | Account                  | yes in combination with `user_id` (what a person may do where)                                                                      | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `invitations.token_hash`                                                                      | Account                  | no alone — a digest of a random token                                                                                               | 30 d after the invitation is consumed, revoked or expires                                                                                                                                                      | hard delete with the row                                                                      | —            |
| `invitations.email`                                                                           | Account                  | yes (the invited address)                                                                                                           | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `invitations.role`, `invitations.permissions`                                                 | Account                  | yes in combination with `email` (what the invited person may do where)                                                              | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `invitations.accepted_at`, `invitations.revoked_at`, `invitations.created_by`                 | Account                  | yes in combination with `email` (when and by whom the invitation was decided)                                                       | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `invitations.expires_at`                                                                      | Account                  | no — a deadline derived from creation                                                                                               | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `auth_throttle_buckets.scope`                                                                 | Security                 | no — the fixed values `ip`/`account` (which budget the row belongs to, not whom)                                                    | minutes (bucket windows); overwritten in place                                                                                                                                                                 | overwrite, never read after window                                                            | —            |
| `auth_throttle_buckets.key_digest`                                                            | Security                 | no alone — HMAC of IP/account, never the value (INV-12); counts and timestamps only                                                 | minutes (bucket windows); overwritten in place                                                                                                                                                                 | overwrite, never read after window                                                            | —            |
| `auth_throttle_buckets.tokens`, `capacity`, `refill_per_second`                               | Security                 | no — bucket arithmetic, no identity                                                                                                 | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `auth_security_events.outcome`, `class`, `reason_class`                                       | Security                 | no — coarse outcome classes, never details                                                                                          | 1 year                                                                                                                                                                                                         | hard delete                                                                                   | AWS          |
| `auth_security_events.source_digest`                                                          | Security                 | no alone — HMAC of IP/subject, never the value (INV-12)                                                                             | same                                                                                                                                                                                                           | same                                                                                          | AWS          |
| `auth_security_events.is_new_family`, `owner_notified`                                        | Security                 | no — heuristic flag + pending obligation flag                                                                                       | same                                                                                                                                                                                                           | same                                                                                          | AWS          |
| `support_access_grants.operator_subject`                                                      | Account                  | yes (the support engineer named by the owner; opaque provider subject)                                                              | 30 d after the grant expires or is revoked                                                                                                                                                                     | hard delete with the row                                                                      | —            |
| `support_access_grants.scope`                                                                 | Account                  | no — the fixed scope value `readonly` (what access was granted, not whom)                                                           | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `support_access_grants.reason`, `support_access_grants.created_by`                            | Account                  | yes in combination (why access was granted, by whom)                                                                                | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `support_access_grants.expires_at`, `support_access_grants.revoked_at`                        | Account                  | no — deadlines derived from creation                                                                                                | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `tasks.title` (minimal table, 0025; P07.06 adds `description`)                                | Account                  | yes in combination (what work was assigned; free text, may name a caller)                                                           | 12 months after closure (Work table: `tasks.title`, `description`)                                                                                                                                             | hard delete with the row                                                                      | —            |
| `tasks.status`                                                                                | Account                  | no — the fixed state-machine value (what state the work is in, not whom)                                                            | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `tasks.assignee_user_id`, `tasks.created_by`                                                  | Account                  | pseudonymous (links a person to their work)                                                                                         | same                                                                                                                                                                                                           | hard delete with the row; unassign sets NULL on membership end                                | —            |
| `tasks.type`, `tasks.priority`, `tasks.due_at`                                                | Account                  | no — fixed catalogue values and a deadline (what kind/when, not whom)                                                               | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `tasks.conversation_id`, `tasks.idempotency_key`                                              | Account                  | pseudonymous (links work to an interaction/key)                                                                                     | same                                                                                                                                                                                                           | hard delete with the row                                                                      | —            |
| `tasks.snoozed_until`                                                                         | Account                  | no — a deadline derived from creation                                                                                               | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `number_routes.e164`                                                                          | Account                  | yes — the dialled business number (routes a caller to a tenant; caller personal data when dialled)                                  | life of the route assignment; released numbers hard-deleted with the row                                                                                                                                       | hard delete with the row                                                                      | Twilio (P11) |
| `number_routes.route_organisation_id`, `number_routes.location_id`                            | Account                  | pseudonymous (links a number to a tenant and site)                                                                                  | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `number_routes.status`                                                                        | Account                  | no — the fixed routing state (active/quarantined), not whom; release is a row DELETE, not a stored status                           | same                                                                                                                                                                                                           | same                                                                                          | —            |
| `session_clock_policy.max_skew`, `reason`                                                     | Platform policy          | no                                                                                                                                  | permanent versioned policy                                                                                                                                                                                     | retain                                                                                        | —            |
| `audit_events.actor_id`, `target_id`, `approval_id`, `correlation_id`, `trace_id`             | Audit                    | pseudonymous identifiers                                                                                                            | **2 years, restricted**                                                                                                                                                                                        | pseudonymisation/crypto-erase design pending P16 and EXT-02                                   | —            |
| `audit_events.source`, `operation`, `target_kind`, `result`                                   | Audit                    | no raw personal value allowed                                                                                                       | 2 years                                                                                                                                                                                                        | retention handler pending P16                                                                 | —            |
| `audit_events.versions`, `validation`, `args_sanitized`                                       | Audit                    | allowlisted keys and constrained values; potentially identifying in combination                                                     | 2 years                                                                                                                                                                                                        | retention handler pending P16                                                                 | —            |
| `audit_events.canonical_payload`                                                              | Audit                    | duplicates the structured event fields above for integrity verification                                                             | 2 years                                                                                                                                                                                                        | retention handler pending P16                                                                 | —            |
| `audit_events.seq`, `prev_hash`, `hash`                                                       | Audit integrity          | no alone                                                                                                                            | 2 years                                                                                                                                                                                                        | retention handler pending P16                                                                 | —            |
| `audit_heads.last_seq`, `last_hash`                                                           | Audit integrity          | no alone                                                                                                                            | life of the tenant                                                                                                                                                                                             | erase after audit retention closes                                                            | —            |
| `audit_chain_population_state.last_registration_epoch`                                        | Audit integrity          | no — a single platform-wide counter of register epochs                                                                              | life of the audit trail                                                                                                                                                                                        | never erased; it is a counter, not a record about anyone                                      | —            |
| `audit_chain_registry.tenant_id`, `registered_at`, `registration_seq`                         | Audit integrity          | no — an opaque tenant identifier and the time its chain began                                                                       | life of the audit trail                                                                                                                                                                                        | erase with the tenant's audit retention (append-only until then)                              | —            |
| `audit_argument_allowlist.operation`, `argument_key`, `value_kind`, `reason`                  | Platform policy          | no                                                                                                                                  | permanent versioned policy                                                                                                                                                                                     | retain                                                                                        | —            |
| Security logs (IP, user agent, auth events)                                                   | Security                 | yes                                                                                                                                 | 1 year                                                                                                                                                                                                         | hard delete                                                                                   | AWS          |

**The audit trail is append-only by construction (INV-10)** — there is no update or delete path.
That is a deliberate tension with erasure, and the resolution is crypto-erase plus the two-year
bound. **EXT-02 must confirm it**: the design position is that the integrity of an audit trail is
itself a legal obligation, and that a pseudonymous actor reference inside it is proportionate.
The P06.10 schema does not implement that erasure mechanism yet. Customer launch must wait for
the P16 retention handler and EXT-02 review; no erasure completion claim is made here.

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
