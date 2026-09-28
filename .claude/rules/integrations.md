---
paths:
  - "packages/integrations/**"
  - "apps/server/src/modules/billing/**"
  - "apps/server/src/modules/**/webhooks/**"
---

# Integrations, webhooks and billing

Read first: `python3 .claude/bin/plan_section.py --section "Integration Architecture"` and
`--section "Webhook verification per provider"`.

- Every inbound webhook is signature-verified before parsing, deduplicated by provider event ID and
  processed idempotently (INV-11); outbound side effects carry idempotency keys.
- INV-20: usage and billing derive from our own immutable usage ledger; Stripe and Twilio are
  reconciled against it, never the reverse.
- Adapters sit behind ports (Principle 10); tests use recorded fixtures and contract tests, never live
  accounts. `stripe`/`twilio` CLIs and live keys are founder-only.
- QG-09 applies to every change here: `/gate-ready` runs both reviewers.
