# Threat model v1 (STRIDE)

Per component and per data flow, with each mitigation mapped to a checklist item so it is a
commitment rather than an intention. Residual risks are listed at the end — a threat model with no
residual risk has not been done honestly.

Flows are `F1`–`F12` from [`../architecture/data-flow.md`](../architecture/data-flow.md).

## What an attacker wants here

Worth stating, because it shapes which threats matter. This system holds a small business's
customer list and answers its telephone. The realistic motivations are:

1. **Competitor intelligence** — a rival wanting a Handwerksbetrieb's customer list and pricing.
2. **Fraud setup** — enough about a caller to impersonate the business to them later.
3. **Disruption** — making a competitor's phone assistant fail during their busiest hours.
4. **Toll fraud and resource abuse** — the classic telephony attack, monetising someone else's
   minutes.
5. **Opportunistic credential theft** — the OAuth tokens to customers' calendars and mailboxes,
   which are worth more than anything in our own database.

Item 5 is the one most likely to be attempted and the most damaging if it succeeds, which is why
credentials are in Secrets Manager by ARN and never in a column (ADR-0020).

## `voice` — Twilio webhooks and ConversationRelay (F2, F3, F5)

| STRIDE | Threat                                                                       | Mitigation                                                                                                                                                                                                                                                                                                                | Item   |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **S**  | Forged webhook pretending to be Twilio, injecting a call that never happened | Signature validated on every request, with the public URL reconstructed from configured hostnames rather than the `Host` header; subaccount checked; a forged signature is a test case                                                                                                                                    | P11.03 |
| **S**  | Caller ID spoofing to impersonate a known customer                           | **See _Caller identity_ below.** This row previously claimed the caller number is never an authentication factor; a review showed that is false as designed, and the mitigation is a second factor, not the number                                                                                                        | P11.11 |
| **T**  | Tampering with the ConversationRelay stream                                  | Signature validated on the WebSocket upgrade, plus a **single-use session token** bound to the CallSid, 60 s TTL, stored hashed. The CallSid alone is _not_ a secret — it is in every webhook body and in the tenant's own provider logs — so binding to it would let anyone who learns one inject turns into a live call | P11.04 |
| **R**  | A caller denying they made a commitment                                      | Structured facts recorded with timestamps; the audit trail records what the system did (INV-10). **No recording exists to fall back on** — accepted, see residual R-3                                                                                                                                                     |
| **I**  | Caller extracting another tenant's knowledge by asking                       | Retrieval is tenant-scoped inside `withTenant`; the model receives only that tenant's approved content (INV-08)                                                                                                                                                                                                           | P09.09 |
| **I**  | Caller extracting system prompts or internal data                            | Response-type allowlist: the model cannot emit free text to a caller (ADR-0011); adversarial extraction cases in the injection suite                                                                                                                                                                                      | P10.12 |
| **D**  | Call flooding to exhaust minutes or concurrency                              | Per-tenant concurrency caps; per-number rate limits keyed by an HMAC pseudonym of the E.164, so the control does not itself breach INV-12; spend alarms with a hard cutoff                                                                                                                                                | P11.12 |
| **D**  | A long call held open to occupy a worker                                     | 10-minute cap; per-turn deadlines, enforced by the call session state machine                                                                                                                                                                                                                                             | P11.05 |
| **E**  | Caller reaching tools they should not                                        | The guard is a **pipeline, not an allowlist**: tenant → tool allowed → permission → schema → preconditions → **ownership** → idempotency → approval → execute → audit. The model holds no credentials and executes nothing (INV-04)                                                                                       | P10.08 |

## Caller identity — the correction a review forced

An earlier draft of this document asserted that **"caller number is never an authentication
factor"**. That was false as designed, and the contradiction was in our own committed artefacts:

- `intents-and-outcomes.md` ships `booking_change`, `booking_cancel` and `existing_matter`.
- PLAN P07.03.01 resolves identity by _"exact E.164 match on an active method"_ — the number and
  nothing else.
- PLAN P20.10.01 permits lookup of _"the verified caller's own bookings"_ and never defines what
  verifies the caller.

So the resolved contact **was** the authorisation decision. The attack is cheap: a German SIP trunk
will send any `From` header, and a victim's number is on their invoice and in the business's own
contact list. Call, say _"ich rufe wegen meines Termins an"_, and you get another person's
appointment time — or, with `booking_cancel`, an unauthenticated destructive write against a real
customer relationship.

### The rule

**A caller's number is a routing and recall signal. It is not an authentication factor, and
nothing may be read or mutated on the strength of it alone.**

| Intent                                                                                         | What the caller may do on caller-ID alone                           | To go further   |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------- |
| `booking_request`, `service_request`, `quote_request`, `callback_request`, `message_for_owner` | Everything — these create new work and disclose nothing             | —               |
| `opening_hours`, `price_question`, `location_directions`                                       | Everything — public knowledge                                       | —               |
| `existing_matter`                                                                              | **Nothing is read back.** The assistant takes a message             | a second factor |
| `booking_change`, `booking_cancel`                                                             | **Nothing.** The assistant takes a message and the owner calls back | a second factor |

**Second factor**, where a tenant enables these intents: a booking reference the caller reads back,
or a code sent by SMS to the number on file and read back. Absent one, the default is refusal plus
a task — which is the product working, not failing.

### A related question the draft never asked

May a telephone call attach a new contact method to an _existing_ contact? If yes, an attacker who
asserts a name and postcode gets their own number attached to the victim's contact, and P07.03.01
then resolves them as the victim on **every future call**.

**The answer is no.** A number seen on a call may only ever create a duplicate candidate for human
approval (INV-09). INV-09 speaks of merges; this states the adjacent case explicitly, because the
draft's silence is what made the chain possible.

| STRIDE | Threat                                                            | Mitigation                                                                                 | Item   |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------ |
| **S**  | Spoofed caller ID resolves as a known contact                     | Resolution grants no privilege; identity-bearing intents require a second factor or refuse | P11.11 |
| **I**  | Another caller's booking disclosed on a spoofed number            | Lookup requires the second factor; otherwise the assistant takes a message                 | P20.10 |
| **T**  | `booking_cancel` executed on a spoofed number                     | Same, and cancellation is a guarded tool with an ownership stage                           | P10.08 |
| **S**  | Caller-asserted identity attaches a method to an existing contact | Never automatic: a duplicate candidate for human approval (INV-09)                         | P07.04 |

Adversarial eval case, required before any tenant may enable these intents: _a spoofed caller ID of
a known contact requests and then cancels a booking → refused, task created, anomaly counted_.

## Ingestion — attacker-controlled text reaching the model

The draft modelled prompt injection only through owner-authored knowledge, framing the adversary as
_"someone with owner access"_ — the least likely one. Every genuinely attacker-controlled path was
missing.

| STRIDE | Threat                                                                                                                                | Mitigation                                                                                                                                                                   | Item   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **T**  | Injection in the caller's own utterance — the primary untrusted channel                                                               | Data fields delimited and never concatenated into instructions; an injection detector; the response-type allowlist bounds what any success could produce                     | P10.12 |
| **T**  | Injection through calendar or mailbox content — **anyone on the internet can put text into an owner's calendar by sending an invite** | Provider content is data, never instruction; the same delimiting and detection                                                                                               | P10.12 |
| **T**  | Injection through imported website content                                                                                            | Import is fetched by an SSRF-safe fetcher and stored as content requiring approval before it is retrievable (INV-08)                                                         | P09.08 |
| **I**  | SSRF through website import into link-local or metadata addresses                                                                     | Allowlisted schemes, blocked private and link-local ranges, redirect limits, and a DNS-rebinding test suite                                                                  | P09.08 |
| **T**  | Malicious uploaded document                                                                                                           | An uploaded document is scanned and quarantined on import; the original is preserved but never executed                                                                      | P09.08 |
| **T**  | Injection through ingested email (P27)                                                                                                | An ingested message's sender is unverified by assumption; its body and every attachment are data, never instruction, and attachment security applies before anything is read | P27.03 |

The closing control is not that the model cannot be fooled — **it is that the model cannot execute**
(INV-04). Injection that changes which tool is _proposed_ still meets the guard's ownership and
schema stages. That is why residual R-7 exists.

## `web` and support access

Absent from the draft entirely, although `web` serves the ops routes.

| STRIDE | Threat                                                                                                                                                                   | Mitigation                                                                                                                                                               | Item   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| **S**  | Operator phishes an owner into approving a support grant                                                                                                                 | The grant names its scope and reason and is created with step-up; the customer sees it; grants are ≤ 72 h and cannot be extended, only re-granted as a new audited event | P06.11 |
| **E**  | Operator exceeds a granted scope                                                                                                                                         | `moin_support_ro` is read-only; operator actions are recorded in the audit trail with an operator actor                                                                  | P06.11 |
| **I**  | Bulk export as the exfiltration sink — one compromised session takes the whole contact list                                                                              | Export is a distinct permission in the matrix requiring step-up, with a per-tenant rate limit, notification to other owners and an ops alert                             | P06.07 |
| **S**  | MFA reset by social engineering — **the "registered business number" is the number our own assistant answers, and billing data is on any invoice the business has sent** | Reset requires more than those two; the runbook treats both as compromised-by-default                                                                                    | P06.09 |
| **E**  | Invitation token reused or replayed                                                                                                                                      | An invitation token is single-use, expiring and bound to the invited address; membership lifecycle changes are audited                                                   | P06.08 |

## Tenant context outside PostgreSQL

RLS is the answer for Postgres and for nothing else in the system. Five surfaces carry tenant
context without it.

| Surface                       | Threat                                                                                                                                                                                                                                    | Mitigation                                                                                                                                                                                                               | Item   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Valkey                        | A cache key or pub/sub channel built without the tenant id is a silent cross-tenant read                                                                                                                                                  | Mandatory key prefix convention, lint-enforced; cache and SSE channel checks in the cross-tenant suite                                                                                                                   | P06.13 |
| SQS envelope                  | A forged or mutated `organisation_id` trusted by a consumer                                                                                                                                                                               | The envelope is a routing hint; the entity is loaded inside `withTenant` and a mismatch is a not-found                                                                                                                   | P06.03 |
| `withSystemWork`              | It **is** the ambient cross-tenant capability, not a mitigation for one. Retention sweeps, the reconciler and the outbox dispatcher all run there                                                                                         | The system-work pattern is explicit and audited, with a claim function bounding what one transaction may read and emit — it is a capability to be constrained, not a control to rely on and emit                         | P06.14 |
| In-process voice config cache | A key or invalidation bug serves one tenant's greeting, intents and limits on another's call                                                                                                                                              | Cache keyed by tenant with a bounded TTL; a cross-tenant cache test                                                                                                                                                      | P11.01 |
| `resolve_route(e164)`         | The **global, RLS-exempt** function that assigns tenant identity to an inbound call. A stale or mis-entered route sends a business's calls to another tenant; a reassigned number delivers the previous business's callers to the new one | Number→tenant set only through an ownership-verified provisioning path; mandatory time-bounded quarantine on release; the `SECURITY DEFINER` function is on the allowlist with `search_path` pinned and a minimal return | P11.01 |

## The tenant as attacker

Every abuse case in the draft assumed the paying customer was benign or careless. For self-serve
software that answers a telephone **in a business's name**, that is the wrong assumption.

| Threat                                                                                                                                                 | Mitigation                                                                                                                                                                        | Item   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sign up, connect a number, and run a phishing line that greets callers as a bank or insurer — we supply the voice, the disclosure and the plausibility | Business verification on the provisioning path before a number is activated; the disclosure names the configured organisation, which is itself evidence, which is itself evidence | P06.04 |
| Claim a number belonging to another business                                                                                                           | Number ownership verified before routing is created; mandatory quarantine on release so a reassigned number cannot deliver the previous tenant's callers                          | P11.01 |
| Configure intents and slots so the assistant asks callers for data the business has no basis to collect                                                | A hard boundary on what may be asked, independent of tenant configuration (INV-14)                                                                                                | P10.09 |
| `provision_tenant` is a `SECURITY DEFINER` function and the one RLS-exempt write path                                                                  | Runs as a dedicated provisioner role on an isolated admin-scoped path; audited; on the `SECURITY DEFINER` allowlist                                                               | P06.04 |

## Supply chain and delivery

| STRIDE | Threat                                                     | Mitigation                                                                                                                     | Item   |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| **T**  | A compromised GitHub Action reaches production credentials | Actions pinned by commit SHA; `permissions: contents: read` by default; no long-lived cloud keys — OIDC only                   | P05.02 |
| **T**  | A malicious transitive dependency                          | Frozen lockfile; install scripts blocked unless allowlisted with a reason; dependency audit and licence check per pull request | P02.08 |
| **I**  | A secret committed and later removed                       | gitleaks over **full history**, because a secret removed in a later commit is still in the repository                          | P02.06 |
| **T**  | An unreviewed artefact promoted                            | Build once, promote by digest; SBOM and provenance attestation                                                                 | P05.09 |

## `api` — owner-facing HTTP (F7, F8, F9)

| STRIDE | Threat                                              | Mitigation                                                                                                                                                                                                                       | Item   |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **S**  | Session theft                                       | Server-side sessions, revocable immediately; secure, `HttpOnly`, `SameSite` cookies; step-up for sensitive operations                                                                                                            | P06.06 |
| **S**  | Credential stuffing                                 | Cognito abuse protection; MFA required                                                                                                                                                                                           | P06.05 |
| **T**  | Cross-tenant write by supplying another tenant's id | Tenant context derived **server-side only** (INV-02); RLS `WITH CHECK` rejects a foreign `organisation_id` on insert and update                                                                                                  | P06.02 |
| **T**  | Mass assignment through an unvalidated body         | Zod at the boundary; unknown keys rejected rather than ignored                                                                                                                                                                   | P06.13 |
| **R**  | An owner denying a deletion or a settings change    | Append-only, hash-chained audit with actor and time (INV-10)                                                                                                                                                                     | P06.10 |
| **I**  | Cross-tenant read                                   | FORCE RLS; `NOBYPASSRLS` role; adversarial cross-tenant suite per table, release-blocking                                                                                                                                        | P06.02 |
| **I**  | Enumerating tenants or contacts through ids         | Opaque identifiers; 404 rather than 403, so existence is not disclosed. Timing and error-shape side channels are covered by the generated route-inventory suite, which requires full route coverage                              | P06.13 |
| **I**  | Stack traces or database errors reaching a client   | A global exception filter returns a fixed `problem+json` shape with a stable code and the correlation id, never a stack trace or an internal message (ADR-0006); asserted for every route by the generated route-inventory suite | P06.13 |
| **D**  | Expensive queries or unbounded pagination           | Cursor pagination with a maximum page size; per-tenant rate limits; statement timeout                                                                                                                                            | P08.09 |
| **E**  | Privilege escalation between roles                  | RBAC checked per route against an explicit permission matrix; the last owner of an organisation cannot be removed                                                                                                                | P06.07 |

## `worker` — queues, timers, outbox (F10, F11)

| STRIDE | Threat                                                         | Mitigation                                                                                                                                                                                                                            | Item   |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **T**  | Replayed or forged provider webhook causing a duplicate effect | Inbox dedup on the provider event id; every effect idempotent (INV-11). Signatures carry no timestamp, so **replay is a separate control**: dedup on `(CallSid, CallStatus, SequenceNumber)` for Twilio, a 300 s tolerance for Stripe | P08.03 |
| **R**  | A job whose execution cannot be reconstructed                  | `job_runs` records every attempt with its outcome; replay is a first-class operation                                                                                                                                                  | P08.06 |
| **I**  | Personal data leaking into a queue or a log                    | The job envelope carries an **ID-only payload** by schema, so a consumer re-reads inside its own tenant transaction; the allowlist redactor covers the log path and is tested on the serialised line (EV-P02-015)                     | P08.01 |
| **D**  | Poison message blocking a queue                                | DLQ with a bounded receive count; redrive after a fix                                                                                                                                                                                 | P08.05 |
| **D**  | Timer storm after an outage                                    | Jittered claim; bounded batch size                                                                                                                                                                                                    | P08.07 |
| **E**  | A job running outside a tenant scope                           | The envelope's tenant id is a **routing hint, not an authorisation**: the entity is loaded inside `withTenant` and a mismatch is a not-found, so a forged or mutated envelope cannot cross tenants (INV-02)                           | P06.03 |

## Data store (F5, F8, F12)

| STRIDE | Threat                                     | Mitigation                                                                                                                                                                                                                                           | Item   |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **T**  | SQL injection altering the schema          | Parameterised queries (lint-enforced); the application role cannot run DDL                                                                                                                                                                           | P06.01 |
| **R**  | Audit entries deleted to hide an action    | Append-only by trigger, `UPDATE`/`DELETE` privileges revoked, per-tenant hash chain                                                                                                                                                                  | P06.10 |
| **I**  | Backup or snapshot disclosure              | Encryption at rest with KMS; backups in a separate, vault-locked account                                                                                                                                                                             | P17.05 |
| **I**  | Credential disclosure from a database dump | **No credential is in the database** — only an ARN (ADR-0020, INV-15)                                                                                                                                                                                | P05.08 |
| **D**  | Connection exhaustion                      | Per-role connection pools bounded against the RDS instance's own limit, set in the parameter group; the readiness probe holds its own single connection and is single-flight, so a health check cannot compete with application traffic (EV-P02-016) | P05.07 |
| **E**  | Application role escalating                | `NOBYPASSRLS`, owns no tables, cannot `SET ROLE`; asserted by the catalog check and by the test harness                                                                                                                                              | P06.01 |

## Provider boundary (F3, F6, F11)

| STRIDE | Threat                                                   | Mitigation                                                                                                           | Item   |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| **S**  | A compromised provider impersonating a tenant's calendar | Per-tenant OAuth with least-scope grants; anomalous change alarms                                                    | P20.03 |
| **T**  | Provider response tampering                              | TLS; schema validation of every response; a malformed response is a failure, never a default                         | P10.03 |
| **I**  | Over-sharing with a model provider                       | System identifiers are stripped before the prompt. **What the caller says is not, and cannot be** — see residual R-2 | P10.05 |
| **D**  | Provider outage cascading into a dropped call            | Failure layers with a deterministic fallback script; `degraded` rather than `failed` (INV-19)                        | P11.07 |
| **E**  | A stolen refresh token used against a customer's mailbox | Secrets Manager with per-integration ARNs; rotation on refresh; revocation deletes the secret (ADR-0020)             | P20.03 |

## Abuse cases (P03.05.02)

These are not STRIDE categories; they are the things that will actually be tried.

### "Ich bin der Inhaber" — social engineering over the phone

A caller claims to be the owner and asks the assistant to read out recent enquiries, change the
opening hours, or say who called today.

**Mitigation.** The assistant has **no privileged mode reachable from a call**. There is no
utterance that elevates a caller: the tool guard's allowlist is per intent, and no intent exposes
another caller's data or mutates tenant settings. Owner actions require an authenticated session in
the app. Attempts are logged as `assistant.action.rejected_by_guard` and covered in the adversarial
eval suite.

**This is the abuse case most likely to be attempted**, because it requires nothing but a telephone.

### Competitor knowledge scraping

A competitor calls repeatedly with pricing and availability questions to reconstruct a business's
offering.

**Mitigation.** Partial by design. The assistant answers what the owner approved for callers to
hear, which is the point of the product — an owner who publishes prices has published them. What is
bounded is _volume_: per-number rate limits, repeated-caller detection, and a digest to the owner
when one number asks many knowledge questions. **Residual risk R-1.**

### Toll-fraud-like traffic

Automated calls to burn minutes and money, or to occupy concurrency during business hours.

**Mitigation.** Per-tenant concurrency caps, per-number and per-prefix rate limits, spend alarms
with a hard cutoff, and premium-rate and unusual-destination blocks at the Twilio level. A tenant
hitting its cap degrades to voicemail rather than failing.

### Malicious knowledge entry

Someone with owner access enters knowledge designed to make the assistant say something harmful, or
to carry an indirect prompt injection.

**Mitigation.** Knowledge is approved before it is retrievable (INV-08) and is retrieved as content
rather than instruction. The response-type allowlist means a knowledge entry cannot change what the
assistant is willing to do. Adversarial evals include indirect injection through knowledge.

### Notification spam as harassment

Triggering many calls so the owner's phone is flooded with notifications.

**Mitigation.** Notification batching and digests; per-tenant caps with escalation preserved for
genuinely urgent items; SMS strictly capped because it costs money.

### Support-access abuse

An operator viewing tenant data without a business reason.

**Mitigation.** No standing access: a grant is customer-initiated, time-boxed, and cannot be
extended, only re-granted as a new audited event. The customer is notified when one is used.
Operator actions are in a separate `ops_audit`.

## Residual risks

| #        | Risk                                                                                                                          | Why it is accepted                                                                                                                                                                                                                                                                                        | Revisit                                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-1**  | A determined competitor can reconstruct published knowledge by calling repeatedly                                             | Answering callers' questions is the product. Rate limits bound the speed, not the possibility                                                                                                                                                                                                             | If a customer reports it                                                                                                                      |
| **R-2**  | Utterance text reaches a model provider                                                                                       | Necessary to understand German speech. Bounded by no identifiers, EU project, no-training headers, and keeping nothing beyond template facts                                                                                                                                                              | If an EU on-premise model becomes viable (ADR-0043)                                                                                           |
| **R-3**  | No recording exists to resolve a dispute about what was said                                                                  | INV-07 forbids it, and the privacy cost of a corpus of consumer speech outweighs the dispute value                                                                                                                                                                                                        | EXT-02 may permit a redacted turn log (ADR-0019)                                                                                              |
| **R-4**  | A compromised owner account exposes **the callers' personal data**, for which the customer is controller and we are processor | Not "the owner's own data" — that framing was wrong, and it is exactly what would justify under-mitigating it. This is a reportable Art. 33 breach affecting people who never had a relationship with us. MFA, revocable sessions, step-up at export, export rate limits and audit bound it to one tenant | Continuously; it is the highest-impact account path                                                                                           |
| **R-5**  | Cognito is a single point of failure for sign-in                                                                              | Operating an identity provider is the larger risk. Callers are unaffected — the phone keeps working                                                                                                                                                                                                       | If Cognito availability proves inadequate                                                                                                     |
| **R-6**  | Erasure cannot reach immutable backups                                                                                        | Backup integrity is itself an obligation. Bounded window, recorded in the deletion ledger                                                                                                                                                                                                                 | EXT-02                                                                                                                                        |
| **R-7**  | Prompt injection is bounded, never eliminated                                                                                 | Delimiting and detection reduce it; the closing control is that the model cannot execute (INV-04), not that it cannot be fooled                                                                                                                                                                           | Each adversarial eval round                                                                                                                   |
| **R-8**  | The model provider is an insider to every conversation                                                                        | Unavoidable while understanding German speech needs a hosted model. Bounded by an EU project, no-training headers, and zero retention as an explicit EXT-12 acceptance criterion                                                                                                                          | ADR-0043, if an EU on-premise model becomes viable                                                                                            |
| **R-9**  | Our telephony provider is an insider to every call                                                                            | Twilio carries the audio and holds the webhook configuration. A compromise of our own provider account re-points a number and intercepts every call to a business in its name — defeating INV-07 from outside our code                                                                                    | Detective: scheduled drift check of each number's Voice and Fallback URLs and recording settings against the versioned expected configuration |
| **R-10** | No per-user data scoping inside a tenant                                                                                      | Every staff account sees every caller. Appropriate for a five-person Betrieb, wrong for a larger customer                                                                                                                                                                                                 | The first customer who asks, or MT-LIVE                                                                                                       |
| **R-11** | No forensic capability on call content after an incident                                                                      | The other side of R-3: with no transcript there is nothing to investigate and no content-based abuse detection. Compensating controls are guard-rejection and anomaly counters, retained **longer** than the 30-day AI record                                                                             | EXT-02, with ADR-0019                                                                                                                         |

## Review

**P03.05.03 requires an independent review**, not an author's re-read. The `security-reviewer`
agent was run against this document and the diagrams it references; its findings are tracked in the
evidence record for this item, and any HIGH or CRITICAL is resolved before the phase is offered for
founder review.
