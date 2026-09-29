# DG-01 — Voice stack go/no-go

- **Gate:** PLAN L497 · **Owner:** founder · **Target date:** 2026-10-09
- **Decision:** **NOT TAKEN**
- **Blocks:** P11 (voice), P12 (dialogue) · **Unblocks on:** `docs/voice/feasibility-report.md`

## The question

Is Twilio Voice with ConversationRelay on the IE1 processing region good enough to build a German
telephone answering product on?

Not "does it work" — it demonstrably works in English in a demo. The question is whether it
answers a German telephone at a latency a caller tolerates, captures the five values the product
depends on, and moves personal data through a chain we can describe to a German small business and
to a supervisory authority.

## Why this record exists before the decision

The criteria below are copied from PLAN P04.06.01, unchanged, and written down while nobody knows
what the measurements will be. Three failure modes this is meant to prevent, in order of how
likely they are:

1. **Adjusting the threshold to the result.** p95 ≤ 1.8 s is in PLAN. If the measurement comes back
   at 2.4 s, the honest outcomes are NO-GO or "a credible path to 1.8 s, and here it is" — not a
   revised threshold.
2. **Deciding on the arithmetic mean.** It is not reported at all, by construction.
3. **Deciding on a small sample and calling it evidence.** N travels with every percentile, and the
   harness marks an under-powered arm.

## Criteria

| #   | criterion             | threshold                                                                      | evidence required                                                              | status        |
| --- | --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------- |
| 1   | Latency               | p95 ≤ 1.8 s end-of-speech to first audio, **or a credible written path to it** | caller-side measurement, N ≥ 50, from eu-central-1                             | not measured  |
| 2   | Critical-slot capture | feasible with read-back and DTMF                                               | per-slot accuracy for all six slot types                                       | not measured  |
| 3   | Disclosure            | plays in full when the caller talks over it (INV-03)                           | observed on a real call                                                        | not observed  |
| 4   | Data flows            | STT/TTS vendors and processing regions acceptable                              | Twilio's **written** answer (P04.10.02), assessed against the DFD and the DPIA | not requested |
| 5   | Cost                  | ≤ the planning assumption per minute                                           | measured per completed call                                                    | not measured  |

A criterion that is not measured is not met. There is no partial credit.

## If GO

- ADR-0010 moves from PROPOSED to ACCEPTED, with this record cited.
- ADR-0012 moves to ACCEPTED once EXT-12 also resolves.
- P11 and P12 unblock.

## If NO-GO

- The specialised voice platforms are evaluated against BLUEPRINT L879 **before P11 starts**, not
  during it.
- `packages/telephony` is where the cost lands, and that was the point of building it behind a
  port. The protocol codecs, the session-token binding and the disclosure builder are not specific
  to ConversationRelay in their reasoning, only in their wire format.
- The DG-01 date moves; the pilot date moves with it. That is the correct consequence, not a reason
  to decide GO.

## What a partial answer means

The likeliest real outcome is not a clean GO or NO-GO: it is latency close to the threshold, good
capture on four slots and poor capture on one, and a data-flow answer from Twilio that is
incomplete. In that case the decision is **deferred with a named next measurement**, not split.
Building P11 against a stack that half-passed is how a NO-GO becomes undiscoverable.

## Decision

> _Recorded by the founder, with a date, the evidence cited, and the status of each criterion at
> the time. Left empty until then._
