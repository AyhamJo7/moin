# EV-P02-044: The security-scan workflow is green: audit, licences, secrets, static analysis, Trivy, SBOM

| Field | Value |
|---|---|
| Evidence ID | EV-P02-044 |
| Item | P02.06.02 |
| Date (UTC) | 2026-09-28 16:56 UTC |
| Commit | `1867d75a2e18138a222de269ed7909a2b196a9b3` (working tree had uncommitted changes) |
| Environment | GitHub Actions, ubuntu-24.04 |
| Command / procedure | Run https://github.com/AyhamJo7/moin/actions/runs/36454320839 at commit 1867d75, conclusion success. Jobs: dependency audit (pnpm audit --prod --audit-level high) and the licence allowlist; gitleaks over full history (fetch-depth 0 — a secret removed in a later commit is still in the repository, and a shallow scan would report clean); semgrep with p/typescript, p/security-audit and p/secrets, plus actionlint and shellcheck; Trivy filesystem ("Clean (no security findings detected)") and a CycloneDX SBOM uploaded as an artifact with 90-day retention. |
| Result | PASS at the second attempt. The first run failed twice over: the gitleaks action now requires a repository token to scan a pull request, and a workflow that checks out contributor code should not hold one — it now runs the pinned gitleaks image with the same configuration the local gate uses. Semgrep flagged three findings, all in code that should not have been in scope: the founder-owned control plane (separately linted with ruff and mypy, and not this session to change) and the ESLint fixtures, which violate rules on purpose. Both are excluded and nothing else is. |
| CI run / artifact | https://github.com/AyhamJo7/moin/actions/runs/36454320839 |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
