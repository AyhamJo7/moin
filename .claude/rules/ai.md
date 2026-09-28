---
paths:
  - "packages/ai/**"
  - "templates/**"
  - "evals/**"
  - "apps/server/src/modules/**/policy/**"
---

# AI orchestration, templates and evals

Read first: `python3 .claude/bin/plan_section.py --section "AI Architecture"` and `--id QG-07`.

- Principle 2 and INV-04: the model proposes, deterministic code disposes. Models hold no credentials
  and execute nothing; tools run only after the full validation chain of the tool guard.
- INV-05: no commitment is spoken or written without a verified tool-result token.
- INV-08: answers use only owner-approved, currently valid knowledge. INV-13: life-safety cases get the
  deterministic reviewed script, never LLM-worded advice. INV-09: identity merges are never decided by
  a model.
- QG-07: any prompt, policy, template or model change ships with a version-bound eval report meeting
  the N minima; adversarial and emergency suites have 0 failures. Held-out sets are never tuned on.
- INV-16 / A-19: no customer data in evals, prompts or fixtures; pilot failures become synthetic
  paraphrases.
