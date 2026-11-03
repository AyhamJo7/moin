# EV-P02-054: PRs 20-23, each with a failing required check, are still BLOCKED by GitHub; direct push is not tested (CLAUDE.md section 8), it follows from the ruleset. Supersedes EV-P02-048.

| Field | Value |
|---|---|
| Evidence ID | EV-P02-054 |
| Item | P02.01.07 |
| Date (UTC) | 2026-11-01 10:49 UTC |
| Commit | `be4591df127cd19e0bceee4e5426c325b119aed3` (while this record was written, only docs/evidence/INDEX.md and earlier records of the same batch differed from this commit; no code or configuration differed) |
| Environment | local clone /tmp/moin-c-rerun, main be4591d, clean tree; Node 24.21.0, pnpm 10.34.5, WSL2; private compose project implrerun (Postgres 17 pgvector, valkey, sqs, mail, oidc) |
| Command / procedure | At HEAD be4591d (clean tree): python3 asserts.py neg-prs (gh pr view 20 21 22 23) -> exit 0; python3 asserts.py ruleset (gh api repos/AyhamJo7/moin/rulesets/24193962) -> exit 0 |
| Result | PASS: PRs 20-23 all closed unmerged, mergeStateStatus BLOCKED, each with its failing check (static, unit, audit/trivy, secret scan); ruleset active; rules deletion, non_fast_forward, pull_request, required_linear_history, required_status_checks (verify, security-scan, container-scan; strict); bypass_actors empty |
| CI run / artifact | main be4591d check-runs all success: verify run https://github.com/AyhamJo7/moin/actions/runs/41269388046, security-scan run .../41269388037, container-scan run .../41269388053 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
