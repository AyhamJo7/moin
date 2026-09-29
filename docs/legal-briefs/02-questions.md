# Questions for counsel

Each carries the decision we need, the stage it blocks, and **what we will do if no answer
arrives** — so a late answer delays rather than paralyses, and so counsel can see which questions
are load-bearing.

Where we have a view, it is stated as ours.

## Stage A — before a single real caller (blocks PG-3)

### A1. Is the disclosure sufficient, and when must it play?

Draft wording in document 03. It plays before any conversational turn.

**Our view:** disclosure before the first turn, in German, in plain language, is the right reading
of both transparency obligations and the AI Act's Art. 50.
**Fallback if unanswered:** the longest, most explicit wording, played first. Verbose beats
unlawful.

### A2. Is the 200-character request field a template-defined fact or a transcript fragment?

The only free text we keep from what a caller said.

**Our view:** it is a fact the template asks for, bounded so it cannot accumulate into a transcript.
**Fallback if unanswered:** drop it. The product is worse — a task that says "Rückruf erbeten"
without the caller's own words — but it ships.

### A3. Is an optional, redacted turn log with a short TTL lawful on the controller's instruction?

Not enabled by default. We would like it available for businesses that ask.

**Our view:** lawful as a processor acting on instruction, provided it is in the AVV and the
disclosure covers it.
**Fallback if unanswered:** the feature does not exist. No code depends on it.

### A4. Is the controller/processor split right, especially for security logs?

Caller data: they are controller, we are processor. Account data: we are controller. Security logs
contain both.

**Our view:** controller for security logs under legitimate interest, processor where they contain
customer content, minimised and access-restricted either way.
**Fallback if unanswered:** treat all security logs as processor data, retain 1 year, restrict
access. More restrictive than needed, and safe.

### A5. What must the AVV say about the subprocessors?

Twilio, OpenAI (EU), AWS, Stripe, and — per tenant, on connection — Google and Microsoft.

**Our view:** all five named in the AVV with a change-notification mechanism; the per-tenant OAuth
ones disclosed at connection.
**Fallback if unanswered:** name every one explicitly with prior written consent for changes.

### A6. Does telecom law (TKG) add obligations beyond the GDPR? — EXT-03

We answer calls on a business's behalf. We are not a telecommunications provider, but we sit in the
path of a telephone conversation.

**Our view:** we are not subject to TKG obligations as a provider; Twilio is the carrier.
**This is the question we are least confident about**, and we would rather be told early.
**Fallback if unanswered:** the pilot does not run. There is no safe default here, which is why it
is stage A.

### A7. Does the emergency script need review before use? — EXT-05

A caller saying "bei mir steht das Wasser im Keller" or describing a medical emergency gets a
deterministic script, never generated wording.

**Our view:** the script must say we are not an emergency service and give the correct number, and
that wording should be reviewed by counsel before any real caller can reach it.
**Fallback if unanswered:** emergency detection stays on and escalates immediately to the owner,
but the assistant says only that it cannot help and gives the public emergency number.

## Stage B — before charging (blocks P26)

### B1. Are the default retention periods defensible, and are the configurable bounds sound?

Defaults and bounds in [`../privacy/data-inventory.md`](../privacy/data-inventory.md).

**Fallback:** the shortest period in each range becomes the default.

### B2. Erasure against an append-only audit trail

The audit trail is append-only by construction, which is itself an integrity control. It holds
pseudonymous actor references.

**Our view:** crypto-erase plus a two-year bound is proportionate, and audit integrity is itself an
obligation.
**Fallback:** shorten audit retention to one year.

### B3. Backups and erasure

Erasure applies to live data immediately; backups are immutable and expire within a bounded window;
the deletion ledger records the date the last backup containing the data expires.

**Our view:** the usual and defensible reading.
**Fallback:** shorten the backup window, at a cost to the recovery point objective.

### B4. Our AI Act role — EXT-04

We believe we are a **provider** of a limited-risk AI system: the obligation is transparency
(Art. 50), which the disclosure discharges.

We believe it is **not high-risk**: it does not decide anything about a person. It books, notes and
escalates, and a human is always in the loop for anything consequential.

**Fallback:** implement the high-risk obligations we can reasonably meet — logging, human
oversight, accuracy measurement — and do not claim a classification we have not had confirmed.

### B5. Tax and commercial retention for billing — EXT-08

We assume eight years for invoices and related records, overriding an erasure request.

**Fallback:** eight years, which is the conservative assumption already.

### B6. What may marketing say?

**We will not claim that EU hosting makes a customer compliant** (BR-100). We would like the
boundary between a defensible claim and a misleading one drawn explicitly.

**Fallback:** describe only mechanisms, never outcomes. "Data is stored in Frankfurt" rather than
"GDPR compliant".

## What we are not asking

We are not asking counsel to review code, or to confirm that a technical control is correctly
implemented. Those are our responsibility and are covered by the technical measures and the
penetration test (P17).
