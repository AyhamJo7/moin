# EV-P09-006: P09.04 FAQ cards: spoken lint, sensitivity gating, 5+3 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P09-006 |
| Item | P09.04.04 |
| Date (UTC) | 2026-10-11 15:14 UTC |
| Commit | `3de4a82` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.3 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 5.0 s); `pnpm lint` → pass (exit 0, 12.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.6 s); `pnpm test` → pass (exit 0, 6.0 s); `pnpm test:integration` → pass (exit 0, 25.5 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.0 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #99 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #99) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/faq.integration.test.ts" --fix-paths packages/db/src/faq.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | ROUND-1 (4 findings): per-run digit lint (innocent-space bypass closed via hasSeparator per run + exact-shape regression); location/channel filters on retrieval (FaqQuery opts, validated, open-by-default with pinning tests; locationId wired through update); deactivate version-locked (stale 409 + test); deactivate audits real sensitivity+version (allowlist already 0..2 + post-write version — no migration change needed). NEW faq_cards table (not knowledge payloads: voice-linted ≤350 spoken + variants trigram + sensitivity gate need their own shape/lifecycle — staff-direct locking, not the publish door). Kernel spoken-lint: URLs + unreadable 6+ digit runs rejected (PLZ 5-digit passes bare), pronunciation hints advisory-only. findAnswer = approved-card verbatim incl. sensitive (their only mode); groundedCandidates EXCLUDES sensitive (marker test pins it — P10 gate reads this). Updates require expectedVersion; deactivation retires from matching; no-match abstains (null). Array-trgm note: gin_trgm_ops rejects text[] — canonical trgm index only, variants via unnest()+%. Audit sensitivity+version markers only (INV-12). Inventory Knowledge possibly-personal rows. Tests 6 integration + 4 unit (3x): verbatim+isolation, lint-at-both-writes, sensitive-verbatim-but-never-ground, stale-409 + deactivate, miss+audit+RLS; lint clean/reject/formatted. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
