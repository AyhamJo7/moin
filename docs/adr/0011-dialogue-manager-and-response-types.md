# ADR-0011 — Dialogue manager and response types

- **Status:** PROPOSED (drafted P03.01.03, 2026-09-29; accepted in P12) · **Deciders:** founder
- **Phase:** P03 → P12 · **Related:** ADR-0039, INV-04, INV-05, INV-08, INV-13

## Context

A caller is on the phone. Whatever the system says, a real person acts on: they arrive at a
restaurant expecting a table, or they wait for a plumber who is not coming.

A language model is very good at understanding "ich wollte fragen ob Sie Donnerstag Abend noch was
frei haben" and very bad at being the thing that decides a table exists.

## Decision (draft)

**A deterministic slot-filling state machine drives the conversation. The model interprets; it does
not decide.**

The dialogue manager is code: a state machine per intent with required slots, validation and
explicit transitions. It decides what to ask next, when it has enough, when to escalate and when to
hand to a human. It is testable, inspectable and identical every time.

**The model does natural-language understanding only**: utterance → intent plus slot values, as
structured output validated against a schema. A parse failure is a re-ask, never a guess.

**Responses come from a response-type allowlist.** The manager selects a type; the wording comes
from a reviewed template. The model never composes a sentence that reaches a caller.

**Any commitment is template-only and follows a verified tool success** (INV-05). "Ich habe Ihnen
Donnerstag 19 Uhr reserviert" may be said only after the booking tool returned success. A timeout
is not success; it produces "Ich habe Ihre Anfrage notiert, der Betrieb meldet sich".

**Life-safety cases bypass the model entirely** (INV-13, ADR-0039): deterministic detection, a
reviewed script, no generated wording.

## Alternatives considered

| Option                                                         | Why not                                                                                                                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An end-to-end conversational model with tools**              | Fluent, and it can commit to something that did not happen, invent an opening time, or improvise wording in a life-safety situation. The failure is a real person acting on a false statement. |
| **A model that generates responses, validated afterwards**     | Validating free text for factual correctness is the same unsolved problem, moved later. The allowlist makes the space of possible sentences finite and reviewable.                             |
| **A pure IVR decision tree, no model**                         | Robust and infuriating. Understanding free German speech is the product; the model is the right tool for exactly that.                                                                         |
| **A model that selects a template but fills its slots freely** | Slots reach the caller. They are validated against the schema instead.                                                                                                                         |

## Consequences

- Every supported intent needs a hand-written state machine. That is the cost of determinism, and
  it bounds the product surface honestly.
- Wording changes are template changes: reviewable, versioned, and covered by an eval (QG-07).
- The system will sometimes say "das kann ich nicht" where an end-to-end model would have improvised.
  That is the intended trade: a caller told the truth beats a caller told something plausible.
- Adding an intent is a product decision, not a prompt edit.

## Open before acceptance (P12)

- The exact response-type set per vertical template.
- Escalation thresholds: how many failed parses before a human hand-off.
- Barge-in and interruption behaviour, which needs the real phone network (P11.17).

## Verification

| Enforcement                                         | Where                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The model never emits caller-facing free text       | Response-type allowlist enforced in code; adversarial evals assert no free text escapes |
| No commitment without a verified tool success       | Eval suite plus an integration test with an injected tool timeout (INV-05)              |
| Model output is schema-validated                    | Structured-output validation in `packages/ai`; a parse failure re-asks                  |
| Life-safety wording is never generated              | Deterministic path test (INV-13); the emergency suite must show zero failures           |
| The model holds no credentials and executes nothing | Tool guard (INV-04), reviewed under QG-09                                               |
