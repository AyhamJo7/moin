# ADR-0010 — Telephony architecture

- **Status:** PROPOSED (P04.04, 2026-09-29) · **Deciders:** founder · **Phase:** P04 → P11
- **Related:** ADR-0012, ADR-0019, INV-03, INV-06, INV-07, INV-19, DG-01, EXT-10, EXT-11

> **This ADR is PROPOSED and must stay that way until DG-01.** It becomes ACCEPTED on the voice
> go/no-go, on evidence from real calls that do not exist yet (P04.05, blocked on EXT-10 and
> EXT-11). An ADR marked accepted before its deciding evidence exists is precisely the failure this
> phase is meant to prevent.

## Context

The product is a telephone answering service. Everything else it does — the tasks, the calendar,
the dashboard — is downstream of a call being answered well in German, by voice, in real time.
That makes the telephony layer both the riskiest part of the system and the one with the fewest
degrees of freedom, because it is almost entirely someone else's infrastructure.

Three constraints are real and not negotiable by us:

**Latency is the product.** A caller who waits two seconds after finishing a sentence concludes
that the line is dead and starts talking again, which makes it worse. The budget is end-of-speech
to first-audio, measured on the caller's device, and PLAN's threshold is p95 ≤ 1.8 s.

**The data is German personal data, some of it special category.** A caller may say why they want
a physiotherapy appointment. INV-07 forbids persisting raw audio at all; the transcript policy is
ADR-0019 and the legal review is EXT-02. Where speech-to-text and text-to-speech actually run, and
what the vendor keeps, is therefore an architectural constraint rather than a vendor detail —
which is why P04.10.02 asks Twilio that question in writing.

**A dropped call is not a retryable error.** INV-19: a caller who is cut off does not see a stack
trace, they conclude the business is broken. Every failure has to degrade to something a person on
a telephone can act on.

## Decision

**Twilio Voice with ConversationRelay, IE1 (Ireland) processing region, behind a port.**

_Why a managed voice stack at all._ The alternative is carrier interconnect, media handling and
codec work, which is six months of specialist effort to reach a worse starting point than a
platform provides on day one. We are not a telephony company.

_Why ConversationRelay rather than raw Media Streams._ ConversationRelay carries transcripts and
synthesis instructions; Media Streams carries µ-law audio frames that we would have to buffer,
segment, transcribe, and synthesise against. The second is more flexible and is a different
product to build. Media Streams remains the escape hatch if a specific need — a custom voice, an
STT vendor ConversationRelay does not offer — turns out to be load-bearing.

_Why IE1._ It is the processing region that keeps the signalling and media path inside the EU.
Whether it also keeps the STT and TTS vendors' processing inside the EU is **not something we
know**; it is the written question in P04.10.02, and its answer can move this decision.

_Behind a port._ `packages/telephony` holds the TwiML builder, the protocol codecs and signature
validation; nothing in the application or domain layers imports a provider SDK, and the
module-boundary rule enforces it. The port is not optimism about switching providers cheaply — a
voice platform migration is never cheap — it is so that a NO-GO at DG-01 costs an adapter rather
than the product.

**Six failure layers, in order.** Each is a thing a caller can experience, not an exception class:

1. **Model or gateway failure** → the deterministic script takes over and the call continues.
2. **Transcription failure** → fall back to DTMF for critical slots; a keypress is not ambiguous.
3. **Session failure** (WebSocket drops) → the `<Connect action>` handler records the interaction
   as an open task rather than losing it (INV-06).
4. **Voice-role failure** → TwiML falls back to a recorded message and a callback promise.
5. **Provider outage** → the number's failover URL answers with the recorded message.
6. **Total failure** → forward to the business's own number, which is what happened before us.

**No recordings.** `record` is never enabled on any call resource, in any environment (INV-07).
Turn logs are text and are governed by ADR-0019.

**The session binding is a secret we mint.** The media WebSocket is public; a `CallSid` is not a
credential — it appears in every webhook body and in the tenant's own provider console. A call's
socket is bound by a single-use, 60-second, hashed token delivered as a TwiML `<Parameter>`.

**Account structure:** one parent account with `staging`, `production` and `monitor` subaccounts.
Per-tenant subaccounts are not used initially; the trigger to revisit is more than 25 tenants, or
a need to isolate one tenant's abuse from the others.

## Alternatives considered

| Option                                                              | Why not                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Twilio Media Streams with our own STT/TTS pipeline                  | More control over voice and vendor, at the cost of building buffering, endpointing, barge-in and synthesis streaming ourselves. That is the specialist work this phase exists to avoid until there is a reason for it. It stays the fallback if ConversationRelay lacks something load-bearing.    |
| A specialised voice-AI platform (Vapi, Retell, Bland)               | Faster to a demo, and it puts the riskiest part of the product, the caller relationship and the data-processing chain inside a vendor we would not control and could not audit. PLAN's NO-GO branch evaluates these against BLUEPRINT L879 criteria, so they are the alternative, not the default. |
| A German or EU carrier-native provider (Sipgate, Placetel, Telekom) | Better regulatory story and stronger German-market credibility, with no comparable real-time AI media path. Revisit if IE1's STT/TTS answer (P04.10.02) is unacceptable.                                                                                                                           |
| US1 processing with contractual safeguards                          | Simpler to enable and it makes every DPIA and every customer conversation harder for the life of the product. Only considered if IE1 lacks a feature the product cannot ship without, and then with counsel (EXT-02).                                                                              |

## Consequences

**What this costs.** A hard dependency on one provider for the part of the product that cannot
degrade. Per-minute cost is theirs to set. A regulatory bundle per German number, with a review
that takes days, means numbers cannot be provisioned on demand for a trial. The STT and TTS
vendors are chosen by Twilio from the set they offer, so the subprocessor chain is partly theirs.

**What becomes harder.** Any future need for custom voice cloning, on-premise processing, or an
STT model we fine-tune would require moving to Media Streams or off Twilio entirely.

**What would make this the wrong call.** If IE1 turns out to route STT or TTS outside the EU and
counsel finds that unacceptable; if p95 latency cannot approach 1.8 s from eu-central-1; if German
number regulatory review proves unworkable for small businesses; or if per-minute cost exceeds the
planning assumption. Each is a DG-01 criterion, and each is measured before this becomes ACCEPTED.

## Verification

| Enforcement                                                            | Where                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| No provider SDK outside the adapter packages                           | `provider-sdks-stay-in-adapters` in `.dependency-cruiser.cjs`                                                              |
| The disclosure is non-interruptible (INV-03)                           | `packages/telephony/src/twiml/connect-relay.test.ts` — the builder has no option to make it otherwise                      |
| An unknown protocol message never ends a call (INV-19)                 | `packages/telephony/src/protocol/codec.test.ts`                                                                            |
| Every webhook is signature-checked                                     | `apps/server/src/modules/voice/http/voice.controller.test.ts`                                                              |
| The media socket rejects a connection without a valid single-use token | `apps/server/src/modules/voice/application/relay-connection.test.ts`                                                       |
| A caller's words never reach a log or `handoffData` (INV-12)           | `relay-session.test.ts`, `codec.test.ts`                                                                                   |
| No call resource enables recording (INV-07)                            | P11 — an assertion over the provider account configuration, and the absence of any `record` attribute in the TwiML builder |
| p95 latency against the DG-01 threshold                                | `docs/voice/feasibility-report.md`, from real calls — **not yet measured**                                                 |
