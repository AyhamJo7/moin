# EV-P02-047: The main-protection ruleset is active: PR required, three required checks, linear history, force-push and deletion blocked, no bypass actors

| Field | Value |
|---|---|
| Evidence ID | EV-P02-047 |
| Item | P02.01.01 |
| Date (UTC) | 2026-09-29 18:17 UTC |
| Commit | `1f22cd4bd309c40b6dd0cc4e3a62a7935dc5d8a7` |
| Environment | github.com/AyhamJo7/moin |
| Command / procedure | gh api repos/AyhamJo7/moin/rulesets/24193962 — exported to docs/evidence/P02/artifacts/ext-24-main-protection-ruleset.json |
| Result | enforcement=active on ~DEFAULT_BRANCH; rules: deletion, non_fast_forward, pull_request, required_status_checks (verify, security-scan, container-scan, strict), required_linear_history; bypass_actors=[] |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
