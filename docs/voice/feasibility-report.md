# German voice feasibility — measurement report

- **Phase:** P04.05 · **Decision it serves:** DG-01 (PLAN L497) · **Owner:** founder
- **Status:** **WAITING_FOR_EXTERNAL** — no calls have been made. Every result table below is empty.
- **Blocked on:** EXT-10 (Twilio account, IE1, DPA) · EXT-11 (German number) · EXT-20 (volunteers) · P05 (eu-central-1) · EXT-12 (OpenAI EU project, for the model arm)

> **Read this first.** This document exists before the measurements on purpose. Its method, its
> thresholds and its table shapes are fixed now, while nobody knows what the numbers will be. A
> threshold chosen after seeing the data is not a threshold, and a method written after the fact
> is a rationalisation. Nothing below is a result until a row has values and a date.

## What is being decided

Whether German voice over Twilio ConversationRelay IE1 is good enough to build the product on.
DG-01 is GO or NO-GO, and a NO-GO means evaluating a specialised voice platform against the
criteria in BLUEPRINT L879 before P11 starts. It is not a decision about whether the idea is good;
it is a decision about whether this stack can answer a German telephone acceptably.

## Method

### The call

Fifty scripted calls, from German mobile and landline networks, to a German number on the IE1
processing region. The script is `apps/server/src/modules/voice/domain/measurement-script.ts` and
is fixed: an ask and a read-back for each of five slot types, then a keypress.

Only scripted replies are spoken. No model wording reaches a caller in this phase (PLAN P04, AI
safety), because a wrong answer from a model would make every other number unattributable.

### The slot types, and why these five

| slot            | why it is here                                                                   | what failure looks like                                     |
| --------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| name            | German surnames, umlauts, and names that are not German                          | the contact is created wrong and every later match fails    |
| phone           | spoken as pairs — _"vierzig, dreiundzwanzig"_ — which is how Germans say numbers | the callback never arrives                                  |
| postcode        | five digits, often run together                                                  | the wrong branch, the wrong service area                    |
| date and time   | _"nächsten Dienstag um halb drei"_ — relative, colloquial, ambiguous             | a booking at the wrong time, which is worse than no booking |
| party size      | short, and easily confused with a time                                           | a table for four at a restaurant with three seats free      |
| keypress (DTMF) | PLAN's answer to a low-confidence critical slot                                  | the fallback itself does not work                           |

An average across these would hide the one that matters. Each is reported separately.

### Latency

The figure DG-01 turns on is **end-of-speech to first-audio, measured on the caller's device**.
It is measured there because a server-side figure omits both network legs and the synthesis queue,
which together are most of what a caller experiences.

Caller-side recording is made **only on the test caller's own device, with written consent**
(EXT-20, `test-call-consent.md`), and is deleted after analysis unless the volunteer consented to
the evaluation corpus. Nothing is recorded on the platform (INV-07).

A second, smaller figure is also collected: `serverTurnaroundMs`, the gap between a final
transcript arriving and our reply being ready. It is what we are responsible for, it is not the
caller's experience, and it is never quoted as if it were.

Percentiles are **nearest-rank**, defined and tested in `packages/ai/src/measurement/latency.ts`.
Every percentile is reported with its N. Timeouts are samples at their deadline, not omissions —
a provider that fails one call in twenty looks excellent if only its successes are measured. No
mean is reported.

### Arms

PLAN P04.05.04 requires comparing two transcription providers and two German voices. The arms are
set by `VOICE_TRANSCRIPTION_PROVIDER`, `VOICE_TTS_PROVIDER` and `VOICE_TTS_VOICE`, so switching
arms is a restart, not a deploy. `speechTimeout` and `interruptSensitivity` are tuned within an arm
and the final values recorded below.

### Where it runs

From eu-central-1 (P05 skeleton, or a minimal temporary task). **Never through a laptop tunnel** —
a tunnelled measurement is a measurement of the tunnel.

## Results

### Latency, caller-side, end-of-speech to first audio

_No calls have been made._

| arm                        | N   | failures | p50 ms | p95 ms | min ms | max ms |
| -------------------------- | --- | -------- | ------ | ------ | ------ | ------ |
| _(pending EXT-10, EXT-11)_ | —   | —        | —      | —      | —      | —      |

### Per-slot capture accuracy

_No calls have been made._

| slot         | arm | N   | exact | corrected by read-back | failed | notes |
| ------------ | --- | --- | ----- | ---------------------- | ------ | ----- |
| name         | —   | —   | —     | —                      | —      | —     |
| phone        | —   | —   | —     | —                      | —      | —     |
| postcode     | —   | —   | —     | —                      | —      | —     |
| datetime     | —   | —   | —     | —                      | —      | —     |
| party_size   | —   | —   | —     | —                      | —      | —     |
| dtmf_confirm | —   | —   | —     | —                      | —      | —     |

### Interruption behaviour

_Not yet observed._ What must be shown: the disclosure plays **in full** when the caller talks over
it (INV-03), and the assistant yields promptly when interrupted after it.

| behaviour                          | expected          | observed |
| ---------------------------------- | ----------------- | -------- |
| disclosure interrupted by speech   | plays in full     | —        |
| disclosure interrupted by keypress | plays in full     | —        |
| assistant interrupted mid-sentence | stops within — ms | —        |

### Model latency from eu-central-1

_Blocked on EXT-12._ PLAN P04.03.05 requires N ≥ 200; the harness marks a smaller arm as
under-powered so it cannot be read as a result.

| arm                | N   | failures | p50 ms | p95 ms | min ms | max ms |
| ------------------ | --- | -------- | ------ | ------ | ------ | ------ |
| _(pending EXT-12)_ | —   | —        | —      | —      | —      | —      |

### Cost per minute

_Not yet measured._ Voice minutes, transcription, synthesis and model tokens, per completed call.

## Chosen configuration

_Not chosen._ To be filled with the arm that wins, and the `speechTimeout` and
`interruptSensitivity` values it ran with.

## Limitations

To be written with the results, and honestly. The ones already known:

- Fifty calls from three people is a small, non-representative sample. It can detect a stack that
  does not work. It cannot establish that one does across accents, ages and noise conditions.
- Volunteers read from a card, so they speak more clearly than real callers do. Every number here
  is an optimistic bound.
- Caller-side timing is taken from a recording, so its resolution is the recording's.
- The numbers describe one processing region on one provider on the days the calls were made.

## DG-01 criteria

Recorded here before the data, from PLAN P04.06.01. Each is met, not met, or not yet measured.

| #   | criterion             | threshold                                          | status           |
| --- | --------------------- | -------------------------------------------------- | ---------------- |
| 1   | latency               | p95 ≤ 1.8 s, or a credible path to it              | not yet measured |
| 2   | critical-slot capture | feasible with read-back and DTMF                   | not yet measured |
| 3   | disclosure            | non-interruptible, verified on a real call         | not yet measured |
| 4   | data flows            | STT/TTS vendors and regions acceptable (P04.10.02) | not yet answered |
| 5   | cost                  | ≤ the planning assumption per minute               | not yet measured |

The decision record is `docs/decisions/DG-01-voice-go-no-go.md`.
