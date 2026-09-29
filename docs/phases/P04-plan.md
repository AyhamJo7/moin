# P04 — Voice and AI Feasibility Proof and Long-Lead External Track · session plan

**Phase:** P04 · **Tier:** PILOT (single tier) · **Target:** 2026-09-29 → 2026-10-09 · **Effort:** 4 engineering-days + founder admin
**Plan source:** PLAN.md L2290–L2404 · **Dependencies:** EXT-10, EXT-11, EXT-12 (requests only), EXT-01 documents for numbers, P05 for eu-central-1 measurement

Planned and executed under the founder's standing program authorization. Nothing here changes
product scope, an invariant, a gate, a threshold, a legal or commercial commitment, or introduces
an architecture deviation PLAN does not already carry.

**Branch base.** This branch starts from `chore/p02-02-qg01-gates`, not from `origin/main`. `main`
is still at the pre-P02 control-plane commit; the integrated P02+P03 state exists only as the
thirteen-deep pull-request stack. Basing on the QG-01 commit is what makes `gates full` run the
fourteen real gates instead of the placeholder that fails by design. The dependency is explicit:
this branch is not mergeable until its whole stack lands. See `docs/development/merge-queue.md`.

## The honest shape of this phase

P04 exists to answer one question — _does German voice over ConversationRelay work well enough to
build on_ — and that question **cannot be answered by engineering alone**. It needs a Twilio
account with IE1 enabled, a German number with an approved regulatory bundle, an OpenAI EU project,
and fifty real phone calls. None of those exist yet, and none can be invented.

So this session cannot deliver P04. What it can deliver, and what it will, is **everything that
must exist before the first real call is worth making**: the protocol code the call runs through,
the measurement apparatus that turns the call into a number, and the decision record with its
criteria written down in advance, so the go/no-go is read off evidence rather than argued after it.

Writing the criteria before the data is the point. A latency threshold chosen after seeing the
measurements is not a threshold.

## Scope split

| Section                                          | Items | Internally executable now                                          | Blocked                                      |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------ | -------------------------------------------- |
| P04.01 Twilio account and IE1 setup `[EXT]`      | 5     | —                                                                  | EXT-10: account, DPA, IE1 enablement         |
| P04.02 German number acquisition `[EXT]`         | 4     | —                                                                  | EXT-11 + EXT-01 documents                    |
| P04.03 OpenAI EU project `[EXT]`                 | 5     | the gateway port, the provider contract tests, the latency harness | EXT-12: project, DPA, eligibility            |
| **P04.04 ConversationRelay adapter**             | 6     | **.01–.05 in full**                                                | .06 needs a real call                        |
| P04.05 Latency and speech measurement            | 5     | the harness, the analysis, the report skeleton                     | the calls themselves, and eu-central-1 (P05) |
| P04.06 Voice go/no-go (DG-01)                    | 2     | the decision record with criteria and an empty evidence table      | the measurements                             |
| P04.07 Brand and domain (DG-00) `[EXT]`          | 4     | **.04 in full** — the brand-string check                           | trademark search, counsel, registration      |
| P04.08 Entity, tax, banking, insurance `[EXT]`   | 5     | —                                                                  | founder and advisers                         |
| P04.09 Google and Microsoft verification `[EXT]` | 4     | —                                                                  | needs the live domain (P05.11)               |
| P04.10 Subprocessor DPAs and regions `[EXT]`     | 4     | the register skeleton, **.04's checker in full**                   | the DPAs and Twilio's written answer         |

## What gets built

### P04.04 — `packages/telephony`, production quality

The phase brief says _"Spike code meets production standards (tests, validation) and is kept."_
This is P11's foundation being written early, not a throwaway.

1. **TwiML builder** (`P04.04.01`). `<Connect action>` + `<ConversationRelay>`. The attributes that
   carry INV-03 — `welcomeGreeting` and `welcomeGreetingInterruptible="none"` — are not optional
   parameters with defaults. A builder that can emit a greeting a caller can talk over is a builder
   that can violate the disclosure invariant, so the type system will not let it.
   XML escaping is the other half: a German business name with `&` in it must not be able to break
   out of an attribute.
2. **Zod codecs** (`P04.04.02`). Inbound `setup`, `prompt`, `interrupt`, `dtmf`, `error`; outbound
   `text`, `play`, `sendDigits`, `language`, `end`. Unknown inbound types are **logged and ignored**,
   never thrown — a provider adding a message type must not drop a call (INV-19).
3. **Signature validation** (`P04.04.03`). `X-Twilio-Signature` for both the HTTP webhook and the
   WebSocket upgrade, constant-time comparison, and URL reconstruction behind an ALB — where
   `X-Forwarded-Proto` decides whether the signature base string says `http` or `https`, and getting
   it wrong fails every request in staging and silently accepts nothing in production.
4. **Minimal voice role** (`P04.04.04`). Inbound webhook → TwiML; a WSS handler with scripted
   replies; the connect-action handler that logs `SessionStatus` and `HandoffData`.
5. **Tests** (`P04.04.05`). Codec round-trips, signature fixtures (valid, tampered, wrong URL,
   wrong body), and a TwiML snapshot that asserts the disclosure attributes are present — a test
   that fails loudly if someone later makes the greeting interruptible.

### P04.05 — the measurement apparatus, not the measurements

A latency figure is only evidence if the method that produced it is written down. The harness
defines the events, the clock discipline (monotonic, one clock, caller-side), the slot taxonomy for
STT accuracy (phone number, name, PLZ, date/time, party size), and the statistics (p50/p95 with N,
never a mean). `docs/voice/feasibility-report.md` ships with its tables present and **empty**, each
marked `WAITING_FOR_EXTERNAL`, so the report cannot be mistaken for a result.

### P04.06 — DG-01 with criteria written first

The decision record exists now, with the five acceptance criteria from PLAN, the evidence each one
requires, and `DECISION: NOT TAKEN`. It is the founder's to take, on the founder's evidence.

### P04.10 — the subprocessor register and its checker

Every pilot data flow in the P03.04 DFD must have a subprocessor entry with a region and a DPA
status. The register is written with every row present and its status honest (`NOT_REQUESTED`), and
`scripts/check-subprocessors.ts` fails if a DFD flow crosses to a party the register does not name.
The check is useful immediately: it is what catches a new provider being added without a DPA.

### P04.07.04 — the brand-string check

ADR-0034 decouples the brand. `scripts/check-brand-strings.ts` greps the tree for hard-coded brand
literals outside the single configuration point, so a rename stays a configuration change. Written
now because it is cheapest before there is code to rename, and because DG-00 is still open.

### ADR-0010 and ADR-0012

Written as `PROPOSED`, with the decision criteria and the rejected alternatives. They become
`ACCEPTED` on DG-01, which is exactly what PLAN says. An ADR marked accepted before its deciding
evidence exists is the failure mode this phase is meant to avoid.

## Execution order and why

1. **Codecs and the TwiML builder first.** Everything else in P04.04 depends on the message types.
2. **Signature validation next**, before the voice role exists — so there is never a commit in which
   an endpoint accepts an unsigned request.
3. **The voice role**, wiring the three together.
4. **The measurement harness**, which consumes the codecs' event stream.
5. **The documents** — feasibility report skeleton, DG-01 record, ADRs, subprocessor register,
   provider-accounts skeleton — last, because each cites what was built.
6. **The two checkers** (`check-brand-strings`, `check-subprocessors`) wired into the gate config
   proposal, since the gate config is a protected path and must go through a founder patch.

## External requests: initiate versus await

| Ref                      | What                                                                              | Founder can initiate now                   | Result needed before         |
| ------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- |
| EXT-10                   | Twilio account upgrade, business profile, DPA, IE1 region + API keys, subaccounts | **Yes — day 1**                            | P04.01.05, P04.04.06, P04.05 |
| EXT-11                   | German number regulatory bundle                                                   | **Yes**, once EXT-01 documents are in hand | P04.02.04, P04.05            |
| EXT-12                   | OpenAI EU project, ZDR/modified abuse monitoring, DPA                             | **Yes — day 1**                            | P04.03.05, P10               |
| EXT-01                   | Founder identity/address documents for the number bundle                          | **Yes**                                    | EXT-11                       |
| EXT-07                   | Trademark clearance by counsel                                                    | **Yes**                                    | DG-00                        |
| EXT-20                   | Volunteer consent for test calls                                                  | **Yes**                                    | P04.05.02                    |
| EXT-06 / EXT-08 / EXT-28 | Insurance, tax adviser, bank                                                      | **Yes**                                    | PG-3, not P04                |

Requests are cheap and slow; results are what gate. Everything in the "initiate" column is in the
founder action queue in `PROGRESS.md` with nothing depending on engineering first.

## Items and verification

| Item          | Kind                     | Verification                                                                                                                                              |
| ------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P04.04.01     | impl                     | TwiML builder; snapshot fixture; escaping test with `&<>"'` in a business name                                                                            |
| P04.04.02     | impl                     | Zod codecs both directions; round-trip property test; unknown-type test asserts log-and-ignore                                                            |
| P04.04.03     | impl                     | Signature validation; fixtures for valid, tampered body, tampered signature, wrong URL, missing header; constant-time comparison asserted by construction |
| P04.04.04     | impl                     | Voice role: webhook → TwiML, WSS handler, connect-action handler                                                                                          |
| **P04.04.05** | **verify**               | The five fixture groups pass and the TwiML snapshot asserts `welcomeGreetingInterruptible="none"`                                                         |
| P04.04.06     | **BLOCKED**              | Needs a real call — EXT-10 + EXT-11                                                                                                                       |
| P04.05.01–.04 | **WAITING_FOR_EXTERNAL** | Harness built; the calls are external                                                                                                                     |
| P04.05.05     | impl (skeleton)          | Report with empty tables and a stated method                                                                                                              |
| P04.06.01     | impl                     | Criteria recorded before evidence                                                                                                                         |
| P04.06.02     | **BLOCKED**              | The decision is the founder's, on evidence that does not exist                                                                                            |
| P04.07.04     | **verify**               | `check-brand-strings.ts` finds the seeded violation and passes on the tree                                                                                |
| P04.10.03     | impl                     | Register with every row, status `NOT_REQUESTED`                                                                                                           |
| P04.10.04     | **verify**               | `check-subprocessors.ts` resolves every DFD external flow to a register row                                                                               |

Evidence IDs are allocated by the registry, sequentially, at the time each record is written.

## Open questions for the founder

**Q1 — ADR-0012 names OpenAI primary; DG-14 selects the EU alternative in P04.03.04.** That
selection needs provider access to be honest (structured-output behaviour and latency differ per
provider, and both are measured, not read off a datasheet). The ADR will therefore list the
candidate set and the selection criteria, and leave the choice open. Confirm that is what you want,
or name the alternative now if you have already decided.

**Q2 — the number end user (P04.02.01).** The plan offers founder Gewerbe, UG, or the customer's
business, with EXT-03 input. This is a legal and commercial decision, not an engineering one, and it
gates the regulatory bundle. It is in the founder action queue as a decision, not a task.

**Q3 — test-call volunteers (EXT-20).** Fifty calls needs two volunteers besides you. Written
consent is required before any caller-side recording. The consent text is drafted as part of this
work so that it is not written in a hurry on the day.
