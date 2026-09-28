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

| STRIDE | Threat                                                                       | Mitigation                                                                                                                                                            | Item   |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **S**  | Forged webhook pretending to be Twilio, injecting a call that never happened | `X-Twilio-Signature` validated on every request; a forged signature is a test case                                                                                    | P11.02 |
| **S**  | Caller ID spoofing to impersonate a known customer                           | Caller number is **never** an authentication factor; it seeds contact resolution only, and a resolved contact grants no privilege                                     | P07.04 |
| **T**  | Tampering with the ConversationRelay stream                                  | TLS; session bound to the call SID; a message for an unknown session is dropped and alarmed                                                                           | P11.05 |
| **R**  | A caller denying they made a commitment                                      | Structured facts recorded with timestamps; the audit trail records what the system did (INV-10). **No recording exists to fall back on** — accepted, see residual R-3 |
| **I**  | Caller extracting another tenant's knowledge by asking                       | Retrieval is tenant-scoped inside `withTenant`; the model receives only that tenant's approved content (INV-08)                                                       | P09.05 |
| **I**  | Caller extracting system prompts or internal data                            | Response-type allowlist: the model cannot emit free text to a caller (ADR-0011); adversarial evals cover extraction attempts                                          | P10.07 |
| **D**  | Call flooding to exhaust minutes or concurrency                              | Per-tenant concurrency caps; per-number rate limits; spend alarms with a hard cutoff                                                                                  | P11.09 |
| **D**  | A long call held open to occupy a worker                                     | 10-minute cap; per-turn deadlines                                                                                                                                     | P11.05 |
| **E**  | Caller reaching tools they should not                                        | Tool guard validates every invocation against the tenant's enabled intents; the model holds no credentials and executes nothing (INV-04)                              | P10.05 |

## `api` — owner-facing HTTP (F7, F8, F9)

| STRIDE | Threat                                              | Mitigation                                                                                                                      | Item   |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **S**  | Session theft                                       | Server-side sessions, revocable immediately; secure, `HttpOnly`, `SameSite` cookies; step-up for sensitive operations           | P06.06 |
| **S**  | Credential stuffing                                 | Cognito abuse protection; MFA required                                                                                          | P06.05 |
| **T**  | Cross-tenant write by supplying another tenant's id | Tenant context derived **server-side only** (INV-02); RLS `WITH CHECK` rejects a foreign `organisation_id` on insert and update | P06.02 |
| **T**  | Mass assignment through an unvalidated body         | Zod at the boundary; unknown keys rejected rather than ignored                                                                  | P06.09 |
| **R**  | An owner denying a deletion or a settings change    | Append-only, hash-chained audit with actor and time (INV-10)                                                                    | P06.12 |
| **I**  | Cross-tenant read                                   | FORCE RLS; `NOBYPASSRLS` role; adversarial cross-tenant suite per table, release-blocking                                       | P06.02 |
| **I**  | Enumerating tenants or contacts through ids         | Opaque identifiers; 404 rather than 403 for another tenant's resource, so existence is not disclosed                            | P06.09 |
| **I**  | Stack traces or database errors reaching a client   | Fixed error contract; no internal detail ever in a response body (ADR-0006)                                                     | P06.09 |
| **D**  | Expensive queries or unbounded pagination           | Cursor pagination with a maximum page size; per-tenant rate limits; statement timeout                                           | P06.10 |
| **E**  | Privilege escalation between roles                  | RBAC checked per route with an explicit matrix test; the last owner of an organisation cannot be removed                        | P06.08 |

## `worker` — queues, timers, outbox (F10, F11)

| STRIDE | Threat                                                         | Mitigation                                                                            | Item     |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| **T**  | Replayed or forged provider webhook causing a duplicate effect | Inbox dedup on the provider event id; every effect idempotent (INV-11)                | P08.02   |
| **R**  | A job whose execution cannot be reconstructed                  | `job_runs` records every attempt with its outcome                                     | P08.03   |
| **I**  | Personal data leaking into a queue or a log                    | Event payloads are identifiers only; the allowlist redactor (INV-12)                  | **live** |
| **D**  | Poison message blocking a queue                                | DLQ with a bounded receive count; redrive after a fix                                 | P08.01   |
| **D**  | Timer storm after an outage                                    | Jittered claim; bounded batch size                                                    | P08.04   |
| **E**  | A job running outside a tenant scope                           | `withSystemWork` is explicit and audited; there is no ambient cross-tenant capability | P06.03   |

## Data store (F5, F8, F12)

| STRIDE | Threat                                     | Mitigation                                                                                              | Item     |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------- |
| **T**  | SQL injection altering the schema          | Parameterised queries (lint-enforced); the application role cannot run DDL                              | P06.01   |
| **R**  | Audit entries deleted to hide an action    | Append-only by trigger, `UPDATE`/`DELETE` privileges revoked, per-tenant hash chain                     | P06.12   |
| **I**  | Backup or snapshot disclosure              | Encryption at rest with KMS; backups in a separate, vault-locked account                                | P17.04   |
| **I**  | Credential disclosure from a database dump | **No credential is in the database** — only an ARN (ADR-0020, INV-15)                                   | P05.08   |
| **D**  | Connection exhaustion                      | Bounded pools per role; the readiness probe has its own single connection and is single-flight          | **live** |
| **E**  | Application role escalating                | `NOBYPASSRLS`, owns no tables, cannot `SET ROLE`; asserted by the catalog check and by the test harness | P06.01   |

## Provider boundary (F3, F6, F11)

| STRIDE | Threat                                                   | Mitigation                                                                                          | Item   |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| **S**  | A compromised provider impersonating a tenant's calendar | Per-tenant OAuth; scope limited; anomalous change alarms                                            | P20.06 |
| **T**  | Provider response tampering                              | TLS; schema validation of every response; a malformed response is a failure, never a default        | P10.04 |
| **I**  | Over-sharing with a model provider                       | Utterance text only, no identifiers; EU project; no-training headers                                | P10.02 |
| **D**  | Provider outage cascading into a dropped call            | Failure layers with a deterministic fallback script; `degraded` state rather than `failed` (INV-19) | P11.06 |
| **E**  | A stolen refresh token used against a customer's mailbox | Secrets Manager with per-integration ARNs; rotation on refresh; revocation deletes the secret       | P20.05 |

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

| #       | Risk                                                                              | Why it is accepted                                                                                                                           | Revisit                                             |
| ------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **R-1** | A determined competitor can reconstruct published knowledge by calling repeatedly | Answering callers' questions is the product. Rate limits bound the speed, not the possibility                                                | If a customer reports it                            |
| **R-2** | Utterance text reaches a model provider                                           | Necessary to understand German speech. Bounded by no identifiers, EU project, no-training headers, and keeping nothing beyond template facts | If an EU on-premise model becomes viable (ADR-0043) |
| **R-3** | No recording exists to resolve a dispute about what was said                      | INV-07 forbids it, and the privacy cost of a corpus of consumer speech outweighs the dispute value                                           | EXT-02 may permit a redacted turn log (ADR-0019)    |
| **R-4** | A compromised owner account sees everything in that tenant                        | It is the owner's own data. MFA, revocable sessions, step-up and audit bound the blast radius to one tenant                                  | If customers ask for per-user data scoping          |
| **R-5** | Cognito is a single point of failure for sign-in                                  | Operating an identity provider is the larger risk. Callers are unaffected — the phone keeps working                                          | If Cognito availability proves inadequate           |
| **R-6** | Erasure cannot reach immutable backups                                            | Backup integrity is itself an obligation. Bounded window, recorded in the deletion ledger                                                    | EXT-02                                              |

## Review

**P03.05.03 requires an independent review**, not an author's re-read. The `security-reviewer`
agent was run against this document and the diagrams it references; its findings are tracked in the
evidence record for this item, and any HIGH or CRITICAL is resolved before the phase is offered for
founder review.
