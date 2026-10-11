# EV-P09-003: ROUND-1 review BLOCK 4 findings: null-abstain, DB CHECKs, version-required, privacy

| Field | Value |
|---|---|
| Evidence ID | EV-P09-003 |
| Item | P09.02.04 |
| Date (UTC) | 2026-10-11 13:32 UTC |
| Commit | `f269b3cb504b354f61f40bb080fcba54567ef8ae` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 23.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 4.9 s); `pnpm lint` → pass (exit 0, 11.3 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.4 s); `pnpm test` → pass (exit 0, 6.0 s); `pnpm test:integration` → pass (exit 0, 24.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.9 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #97 (draft, this push): CI pending at push time |
| Reviewer | round-1 re-review BLOCK (4 findings, all valid); dispositions below |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/profile.integration.test.ts" --fix-paths packages/db/src/profile.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | Null-abstain: renderAnswer returns null on missing required fields (price {} and max-only, empty names/areas/lists) — callers abstain, never a false ": ab 0 Euro". DB CHECKs mirror kernel (00000/00xxx refused on postal_code, area_center_plz, and inside area_postcodes via immutable app.all_plz_ok helper — CHECK cannot subquery, 0A000 probe-verified; helper EXECUTE to app+migrator); service_area XOR at the DB boundary (neither/both violate). Direct-SQL tests: 00000 + neither + both + 00xxx-array → 23514. Updates require expectedVersion (upsert splits: INSERT new, UPDATE 409s without version — no silent unconditional path). Privacy: name/phonetic/street/plz/city reclassified possibly-personal (sole proprietors). Parser note: inventory needs single-column rows (multi-column AND-continuations parse as phantom AND columns); CHECK continuations kept single-line. Tests 6 (3x): render-12, invalid+no-overwrite, stale+missing-version 409, null-abstain, DB-CHECK 23514s, RLS isolation. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
