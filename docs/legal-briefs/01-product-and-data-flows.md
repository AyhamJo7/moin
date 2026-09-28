# Product description and data flows

For external counsel. Written to be read by someone who has not seen the system.

## What the product does

A small German business — a restaurant, a plumber — misses telephone calls because the people who
could answer are working. This product answers instead.

A caller rings the business's number. The call is routed to our system. The caller hears a **German
disclosure that they are speaking to an automated assistant**, then a conversation: the assistant
understands what they want, answers from information the business owner has approved, and turns
anything needing a human into a task the owner sees.

The caller is **the business's customer**, not ours. They have no account and no relationship with
us.

## Who is who

| Party                       | Role we believe applies               | Why                                                              |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| The business (our customer) | **Controller** for caller data        | They decide why and how their customers' data is processed       |
| Us                          | **Processor** for caller data         | We process on their instruction, under an AVV (Art. 28)          |
| Us                          | **Controller** for their account data | Billing, support, security, product analytics — our own purposes |
| Twilio                      | Subprocessor                          | Telephone network and the audio stream                           |
| OpenAI (EU)                 | Subprocessor                          | Understanding the caller's speech                                |
| AWS                         | Subprocessor                          | Hosting, storage, identity                                       |

**Question for counsel:** is that split right, particularly for the security logs, which contain
both our own operational data and traces of callers?

## What happens to a call, step by step

1. **The call arrives.** Twilio receives it and notifies us. We learn the caller's number if the
   network presents it.
2. **Disclosure.** Before any conversation, the caller hears that they are speaking to an automated
   assistant. Draft wording is in document 03.
3. **The caller speaks.** Audio streams through Twilio to our service. **It is never written to
   disk, in any environment, in any configuration.** There is no setting that enables recording.
4. **Understanding.** The utterance is sent as text to OpenAI's EU project to extract what the
   caller wants and the details they gave. Sent without identifiers — the provider receives an
   utterance, not a person. No-training headers are set.
5. **What we keep.** Not the audio. Not a transcript. Only what the template defines as a fact:
   what they wanted, the details they gave (a name, a callback number, a party size, a postcode),
   the outcome, and **one free-text field capped at 200 characters** for the request in their own
   words.
6. **The owner acts.** A task appears in the owner's app.
7. **Retention.** Call metadata 90 days; structured facts 90 days by default, configurable by the
   business between 30 and 365; contacts for as long as the business relationship continues.

## The position we have taken, and the alternative

**We do not keep audio, transcripts or turn logs by default.**

Turn logs would make the system easier to debug and to evaluate, and would give evidence in a
dispute. We have chosen not to keep them because doing so means holding a corpus of German
consumers' speech, with a breach impact and a subject-access surface that grow with it — and
because starting without it and adding it deliberately is far easier than the reverse.

**The alternative we would like assessed:** an _optional_, redacted turn log with a short TTL,
enabled only on the controller's instruction. Is that lawful, and what must the AVV say?

**The 200-character request field is the part we are least sure of.** It is free text the caller
spoke. We cap it so it cannot become a transcript by accumulation, and we treat it as a
template-defined fact. **Is that defensible, or is it a transcript fragment?**

## Where the data is

Everything at rest is in AWS `eu-central-1` (Frankfurt). Twilio is configured for EU where
available. OpenAI is an EU project. Stripe processes billing in the EU.

We do not claim that EU hosting makes the product compliant. It is one fact among several.

## What the caller can ask for

A caller's rights are exercised against **the business**, as controller. We provide the tooling:
the business can search by phone number or email, export what is held, and erase it. Erasure
removes live data immediately; backups are immutable and expire within a bounded window, with the
date recorded.

**Question for counsel:** is that backup position acceptable, and must the business's privacy
notice state it explicitly?

## What we deliberately do not do

- No call recordings, in any configuration.
- No voice biometrics or speaker identification.
- No emotion or sentiment inference.
- No profiling of callers, and no cross-business data sharing — one business's data never informs
  another's assistant.
- No automated decision with legal or similarly significant effect: the assistant books, notes and
  escalates; it does not decide anything about a person.
- No training of any model on customer or caller data.

The last two matter for the AI Act questions in document 02.
