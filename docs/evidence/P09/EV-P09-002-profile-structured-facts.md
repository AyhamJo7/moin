# EV-P09-002: P09.02 business profile: structured facts, validation, German templates, 4 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P09-002 |
| Item | P09.02.04 |
| Date (UTC) | 2026-10-11 07:29 UTC |
| Commit | `c74841218bb3d93db33b72af92895d8422151ac4` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.3 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 4.6 s); `pnpm lint` → pass (exit 0, 10.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.2 s); `pnpm test` → pass (exit 0, 5.8 s); `pnpm test:integration` → pass (exit 0, 23.5 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #97 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #97) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/profile.integration.test.ts" --fix-paths packages/db/src/profile.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | NEW business_profile table (not knowledge_versions payloads): structured per-category columns with presence CHECKs tied to category beat free-text bodies — JSONB-in-body would bypass per-field constraints and mix lifecycles (profile = staff-direct optimistic locking, knowledge = draft→approve door). 0053: one row per (org, category), RLS+FORCE, category + presence CHECKs, EUR-only until P23. Validation reuses kernel PostalCode (00000/00xxx refused) + Money (whole cents ±10M). PLZ-XOR-radius enforced in service (exactly one shape). Templates pure deterministic German (no LLM). Param typing: casts travel with values per statement (42P08 untyped-$2/NULL across shared skeletons — every placeholder cast, category/version cast). Audit category+version markers only (INV-12). Inventory per-column rows (wildcard rejected by gate). Tests 4 (3x): all-12-category German render, 7 invalid rejections + no-overwrite, stale-409 + audit-content, RLS isolation. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
