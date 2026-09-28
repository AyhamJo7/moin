# ADR-0019 — Turn logs and transcripts

- **Status:** PROPOSED — **final only after EXT-02** (drafted P03.01.03, 2026-09-29)
- **Deciders:** founder, with external legal input · **Phase:** P03 → P16
- **Related:** ADR-0018, INV-07, INV-08, INV-12, DG-13, EXT-02

## Context

A caller speaks. Keeping what they said would make debugging, evaluation and dispute resolution far
easier. It would also mean holding recordings of German consumers' speech, which is personal data,
sometimes special-category data when a caller volunteers a health detail, and subject to telecom
confidentiality rules on top of the GDPR.

This is a decision with a legal answer, and this session does not have it.

## Decision (draft — the conservative default)

**No audio is persisted, ever** (INV-07). Not a draft position: audio is processed in memory for
the duration of the call and never written to disk or to an object store. This part is not open.

**By default, no transcripts and no turn logs.** What persists is what a template defines as a
fact: the intent, the validated slots, the outcome, and a single free-text request field capped at
**200 characters** where a template calls for one.

**Bot utterances persist as template and card identifiers**, not as text. The wording is
reconstructable from the versioned template, so a dispute can be answered without storing what was
said as content.

**An optional redacted turn log with a TTL** may be enabled **on controller instruction** — the
tenant is the controller for their callers' data; we are the processor. If enabled, it is redacted,
short-lived, and separately recorded in the inventory and the AVV.

## Why the default is "no"

The value of turn logs is real: better evals, faster debugging, evidence in a dispute. The cost is
holding a corpus of consumer speech, with a breach impact and a subject-access surface that scale
with it. For a pilot whose purpose is to establish that the product works at all, the corpus is not
yet worth its risk — and starting without it and adding it deliberately is far easier than starting
with it and removing it.

## What EXT-02 must settle

1. Whether the 200-character request field is defensible as a template-defined fact, or is
   effectively a transcript fragment.
2. Whether the optional redacted turn log is lawful on controller instruction, and what the AVV
   must say about it.
3. Whether telecom confidentiality (TKG §3) adds requirements beyond the GDPR for a service that
   answers calls on a business's behalf.
4. What the caller must be told, and when, for each option (INV-03 disclosure wording).
5. Retention periods for each category, and their interaction with the backup window (ADR-0018).

**Until those are answered this ADR stays `PROPOSED` and the default holds.** No code may rely on
turn logs existing.

## Alternatives considered

| Option                                       | Why not (yet)                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Full transcripts by default**              | Largest evaluation value, largest breach impact and DSAR surface, and the hardest disclosure position. Not defensible before legal review.                   |
| **Transcripts with automatic PII redaction** | Redaction of free-form German speech is imperfect, and an imperfect redactor that is trusted is worse than none. Could become viable with measured accuracy. |
| **Nothing at all, not even template facts**  | The product cannot function: a task needs to say what the caller wanted.                                                                                     |
| **Audio recordings**                         | Refused outright by INV-07, independent of EXT-02.                                                                                                           |

## Consequences

- Evaluation relies on the consented corpus (EXT-20) and synthetic cases rather than production
  traffic. Slower, and does not require a corpus of real callers' speech.
- Some disputes cannot be resolved from stored data. Accepted deliberately.
- If EXT-02 permits turn logs, they arrive as an opt-in with their own inventory entry, retention
  policy and disclosure — not as a default flipped on.

## Verification

| Enforcement                                         | Where                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No audio is persisted                               | Storage assertion in the voice path plus a test that no object is written during a call (INV-07) |
| No transcript field exists while this is `PROPOSED` | Schema check: no free-text column beyond the capped request field                                |
| The request field is capped                         | Schema constraint at 200 characters, asserted in tests                                           |
| Bot utterances persist as identifiers               | Schema test: the turn record references a template version, not text                             |
| Disclosure is played before any AI voice session    | INV-03 test in the voice flow (P12)                                                              |
