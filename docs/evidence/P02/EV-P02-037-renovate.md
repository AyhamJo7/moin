# EV-P02-037: Renovate: weekly grouped updates, immediate security updates, lockfile maintenance

| Field | Value |
|---|---|
| Evidence ID | EV-P02-037 |
| Item | P02.08.01 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | renovate.json: weekly schedule before 6am Monday in Europe/Berlin with non-major updates grouped into one pull request; vulnerabilityAlerts and osvVulnerabilityAlerts enabled with schedule "at any time" and raised priority, so a security fix does not wait for the batch; monthly lockfile maintenance; major updates and the ADR-0002 toolchain baseline (node, pnpm, typescript, typescript-eslint, eslint) require dashboard approval, because a bump there is an ADR amendment rather than a routine update; github-actions, dockerfile and docker-compose managers keep digests pinned (P02.06.06); minimumReleaseAge of 3 days on non-major updates, because a release published an hour ago has had no time to be found compromised or broken. Renovate opens pull requests and never merges: merging to main is a founder action. |
| Result | PASS as configuration. NOT YET EXERCISED: Renovate only runs once the GitHub App is installed on the repository, which is a founder action. Its first real pull request is the verification, and it is recorded as a founder item rather than claimed here. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
