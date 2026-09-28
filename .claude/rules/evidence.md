---
paths:
  - "docs/evidence/**"
  - "docs/phases/**"
  - "PROGRESS.md"
---

# Evidence and ledgers

Read first: `python3 .claude/bin/plan_section.py --conventions` (status model, evidence rules,
"no fake completion").

- Records are created with `python3 .claude/bin/evidence.py new ...` (next ID, required fields, INDEX
  row) and audited with `evidence.py check`. Never hand-number EV IDs.
- Order of updates: Status Ledger (PLAN.md) first, phase header second, PROGRESS.md row third.
- Sensitive evidence (pentest reports, legal opinions, contracts, customer data) is stored by reference
  only: location, SHA-256, date, counterparty. No screenshots with personal data.
- Implementation and verification are separate items; a tick without an EV ID is not allowed.
