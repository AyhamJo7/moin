# EV-P02-041: local-setup, testing and conventions guides

| Field | Value |
|---|---|
| Evidence ID | EV-P02-041 |
| Item | P02.07.01 |
| Date (UTC) | 2026-09-28 16:55 UTC |
| Commit | `1867d75a2e18138a222de269ed7909a2b196a9b3` |
| Environment | local |
| Command / procedure | docs/development/local-setup.md: prerequisites and why each is pinned, the exact sequence, what each of the six services is, the database role split and why it exists locally, how to run and reset, and a symptom/cause/fix table for the failures that actually happen (daemon unreachable, a system Postgres on 5432, missing env, permission denied for schema public, Keycloak taking ~20 s on first boot, outdated lockfile). docs/development/testing.md: the three suites, the two non-negotiable rules (real Postgres because an embedded one runs as superuser and bypasses RLS; every data-touching test passes standalone, which is structural because each integration file clones its own database), synthetic data, the clock, failure-path helpers, the mutation-check requirement for bug fixes, accessibility, the flake policy and coverage expectations. docs/development/conventions.md: the rules that are not obvious from reading the code, each with the failure it prevents. Every relative link in these files, plus README, CONTRIBUTING, ARCHITECTURE and SECURITY, was resolved mechanically — 0 broken. |
| Result | PASS. Each document explains why rather than only what, because a convention without its reason is the first thing dropped under pressure. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
