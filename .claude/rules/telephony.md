---
paths:
  - "packages/telephony/**"
  - "apps/server/src/main-voice.ts"
  - "apps/server/src/modules/voice/**"
  - "apps/server/src/modules/telephony/**"
---

# Telephony and voice

Read first: `python3 .claude/bin/plan_section.py --section "Voice turn pipeline and latency budget"`,
`--section "Failure layering for calls"`, `--id ADR-0010`.

- INV-03: no AI voice session starts without the fixed German AI disclosure played in full
  (`welcomeGreetingInterruptible="none"`).
- INV-19 / INV-06: every failure path ends in a spoken message plus a callback capture or human route;
  no interaction ends without an outcome or an open task.
- INV-07: no raw call audio is persisted, by us or by Twilio.
- Twilio webhooks are signature-verified; provider events are idempotent (INV-11). Sessions never use
  the `twilio` CLI or real numbers; the protocol simulator and recorded fixtures are the test path.
