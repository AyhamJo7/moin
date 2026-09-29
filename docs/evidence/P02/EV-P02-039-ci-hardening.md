# EV-P02-039: Every action and container image pinned by SHA; minimal permissions; concurrency; caching

| Field | Value |
|---|---|
| Evidence ID | EV-P02-039 |
| Item | P02.06.06 |
| Date (UTC) | 2026-09-28 16:47 UTC |
| Commit | `4e723368a81551da43ec157e866362437f25b22f` (working tree had uncommitted changes) |
| Environment | local (actionlint via its pinned image) |
| Command / procedure | All four workflows: permissions default to contents: read and no job widens it; every checkout uses persist-credentials: false so a write-capable token is never left on disk in a job that runs repository code; concurrency groups per ref with cancel-in-progress; pnpm store caching via setup-node. Pinning audited mechanically: 18 `uses:` references across the workflows, every one ending in a 40-character commit SHA with the version in a trailing comment, and every container image referenced in a `run:` block pinned by sha256 digest (actionlint, semgrep, hadolint, pgvector). actionlint run over all four files: verify OK, security-scan OK, container-scan OK, pr-title OK. |
| Result | PASS — 0 unpinned references. actionlint found a real error on the first run: GitHub expressions accept only single quotes, and `join(needs.*.result, " ")` in the aggregate job of all three new workflows was a syntax error that would have failed at runtime. Fixed and re-linted. Four container digests were initially written from memory and were wrong; each was replaced with a digest obtained by pulling the image. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
