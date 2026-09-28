# EV-P02-026: Example environment file with fake values only; every .env ignored

| Field | Value |
|---|---|
| Evidence ID | EV-P02-026 |
| Item | P02.04.03 |
| Date (UTC) | 2026-09-28 13:10 UTC |
| Commit | `adbe336fea37b1cf83e27b27cd928044e117afe4` (working tree had uncommitted changes) |
| Environment | local (gitleaks 8.30.1) |
| Command / procedure | Created .env.example with development-only placeholders and a header stating that real secrets live in AWS Secrets Manager referenced by ARN (INV-15). .gitignore ignores .env and .env.* with a negation for the example: git check-ignore .env -> ignored; git check-ignore .env.example -> not ignored. gitleaks over the whole tree initially reported 9 findings, all in apps/web/.next build output (per-build preview and encryption keys, gitignored and regenerated each build). Added .gitleaks.toml which EXTENDS the default ruleset (useDefault = true, so no upstream rule is lost) and narrows only where it looks, plus a custom rule that fires if a real-looking credential is ever assigned in the example file — the realistic way a secret reaches this repository. Rescan: 0 findings. |
| Result | PASS — 0 findings, every environment file ignored except the committed example. The provider credential lines in the example are commented out and named *_SECRET_ARN, so the shape a developer copies is a reference, not a secret. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
