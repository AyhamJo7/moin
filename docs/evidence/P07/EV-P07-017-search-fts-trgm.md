# EV-P07-017: P07.12 search: german FTS + trgm indexes, RLS search API, 5 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-017 |
| Item | P07.12.03 |
| Date (UTC) | 2026-10-11 04:02 UTC |
| Commit | `42de06ca3147a63acd491f8c307a337c5a0df920` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.2 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 4.5 s); `pnpm lint` → pass (exit 0, 13.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.2 s); `pnpm test` → pass (exit 0, 5.8 s); `pnpm test:integration` → pass (exit 0, 21.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.6 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #93 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #93) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/search.integration.test.ts" --fix-paths packages/db/src/search.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | 0051 expression GINs (no backfill, no rewrite): contacts german-FTS + lower() trgm, tasks title FTS, notes body FTS (live only), method value trgm for digit fragments. unaccent extension via init script + test harness (migration-role privilege split, same as pg_trgm); unaccent STABLE so query-time only, lower() index prunes. searchTenant: plainto_tsquery + similarity + digit-folded ILIKE, all parameterised; per-leg score bands (FTS+2/trgm+1/phone+0) so UNION legs rank once via MAX+GROUP BY and the (score-text, id) cursor advances disjoint (float4/float8 text mismatch defeated exact-equality cursors — text comparison); audit carries query_len + scope marker only (INV-12). Tests 5 (3x stability): umlaut/ascii legs, digit fragment, stem + audit-content, cursor disjoint + RLS isolation, input rejection. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
