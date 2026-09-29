# ADR-0012 — AI gateway and provider strategy

- **Status:** PROPOSED (P04.03, 2026-09-29) · **Deciders:** founder · **Phase:** P04 → P10
- **Related:** ADR-0010, ADR-0011, INV-04, INV-05, INV-08, INV-12, INV-20, DG-01, DG-14, EXT-12

> **PROPOSED until DG-01.** The provider decision depends on EU project eligibility (EXT-12) and on
> latency measured from eu-central-1 (P04.03.03) — neither of which exists yet. What is decided
> here, and is already built, is the _shape_: the port, the tiers, and the rule that structured
> output is required rather than hoped for.

## Context

The product puts a language model on a live telephone call with a member of the public, on behalf
of a business, in German. Three things follow from that sentence, and they are what this decision
has to satisfy.

**It must be fast.** The model is inside the latency budget in ADR-0010. A model that is two
seconds better at reasoning and one second slower is the wrong model for a phone call.

**It must be structured.** The dialogue manager acts on what the model returns: an intent, slot
values, a decision to hand off. INV-05 says no commitment is made without verified success, and a
caller cannot be told "your appointment is booked" because a model produced a sentence that looked
like agreement. Prose is not an answer.

**It must be lawful, and provably so.** German small businesses will ask where the data goes.
"An EU endpoint" is not an answer unless the contract says so: an EU-resident project, a signed
DPA, no training on our data, no retention beyond the request (`store: false`), and modified abuse
monitoring or zero data retention where it is available. Every one of those is a request the
founder has to make and wait for (EXT-12).

There is a fourth constraint that is easy to miss: **we cannot be sure we will be allowed**.
Enhanced-privacy tiers are granted, not bought. A plan that assumes approval is a plan with a
single point of failure outside our control.

## Decision

**A model gateway port, two tiers, strict structured output, and a pre-registered EU alternative.**

_The port_ (`packages/ai/src/gateway/port.ts`) is deliberately smaller than any provider's SDK: a
list of messages, a schema, a deadline, and a tier. Streaming deltas, assistants, threads and
vendor tool formats are absent. A port that mirrors one vendor's surface is that vendor's SDK with
extra steps, and switching is then a rewrite anyway.

_Two tiers, not model names._ Callers ask for `fast` or `strong`; the mapping to a provider model
id is configuration. Providers deprecate models with ninety days' notice as a matter of routine,
and a model id in forty call sites turns routine into an incident.

_Structured output is required._ Every call declares the shape it expects and receives it parsed
or receives a typed failure. `invalid_output` is a distinct outcome from `refused` and from
`timeout`, because the caller must do something different in each case, and a caller that cannot
tell them apart will treat a refusal as a malfunction (INV-05, INV-08).

_Failure is a value, not an exception._ `timeout`, `rate_limited`, `invalid_output`, `refused`,
`provider_error`. A voice turn cannot wait for an exception to bubble; it has a deterministic
script to fall back to (ADR-0010, failure layer 1).

_OpenAI's EU project is the intended primary_, subject to EXT-12. **One alternative EU-resident
provider is selected, contracted and kept working** — DG-14. Not as a diagram box: the fallback
that has never run is the fallback that does not work. Selection is deferred because structured
output behaviour and latency differ per provider and both are measured, not read off a datasheet.

_An async-only fallback model_ covers the case where every real-time provider is unavailable: work
that would have been done in the call becomes a task for the business, which is degraded service
rather than a lost interaction (INV-06).

_No credentials reach a model, and no model executes anything_ (INV-04). The gateway carries text
and structure. Tool execution is the tool guard's, on our side of the boundary, after validation.

_Every call is metered into our own usage ledger_ (INV-20), keyed by the idempotency key, so a
retry is not billed twice and billing never derives from a provider's invoice.

## Alternatives considered

| Option                                                         | Why not                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Call the provider SDK directly from the dialogue layer         | Fewer files, and it makes the provider decision permanent: the dialogue code becomes the integration. The decision this ADR exists to defer is exactly the one that would become undeferrable.                                                 |
| A third-party gateway or router (LiteLLM, OpenRouter, Portkey) | Real work saved on multi-provider routing, at the cost of adding a subprocessor that sees every prompt — which in this product means what a caller said. It would have to appear in the subprocessor register and the DPIA, for a convenience. |
| Self-hosted open-weight models in our own EU infrastructure    | The strongest privacy story available, and it makes us responsible for GPU capacity, latency under load and model quality on German telephone speech, in a phase whose purpose is to _reduce_ risk. Revisit when scale justifies it.           |
| One provider, no alternative                                   | Simpler and cheaper until the day enhanced-privacy access is refused, revoked, or the provider has an outage during business hours. DG-14 exists because that day is not hypothetical.                                                         |
| Free-text model output with our own parsing                    | Tolerant to prompt drift, and it makes `invalid_output` indistinguishable from a plausible wrong answer — which is the one distinction INV-05 depends on.                                                                                      |

## Consequences

**What this costs.** Two provider relationships, two DPAs, two sets of prompts to keep working,
and a port that is one more layer between a call site and the thing it calls. The tier mapping is
one more piece of configuration to get wrong.

**What becomes harder.** Provider-specific features — a vendor's native tool-calling protocol, its
caching, its assistants API — are not reachable without widening the port, and widening it is a
decision rather than an import.

**What would make this the wrong call.** If the EU alternative never materialises in a usable form,
the port's main justification weakens to provider-deprecation insurance, which is real but smaller.
If structured-output support proves too weak across providers to rely on, the dialogue layer needs
a different contract with the model, and that is a larger change than this ADR.

## Verification

| Enforcement                                                           | Where                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| No provider SDK outside the adapter packages                          | `provider-sdks-stay-in-adapters` in `.dependency-cruiser.cjs`                                                                |
| Output is validated against the caller's schema before it is returned | `packages/ai/src/gateway/fake.test.ts` — even the test double validates, so a test cannot pass on a shape production rejects |
| Failure detail never carries model output or the prompt (INV-12)      | `fake.test.ts` — the detail is schema paths only                                                                             |
| Latency has a definition before it has values                         | `packages/ai/src/measurement/latency.ts`, with N carried beside every percentile and an under-powered arm marked as such     |
| Every call is metered (INV-20)                                        | P10 — the usage ledger write is part of the gateway adapter, not of its callers                                              |
| The EU alternative is exercised, not just contracted                  | P10 — the contract suite runs against both providers                                                                         |
