# EV-P07-016: ROUND-3 residual: version+updated_at bump on every merge reparent

| Field | Value |
|---|---|
| Evidence ID | EV-P07-016 |
| Item | P07.04.04 |
| Date (UTC) | 2026-10-11 03:39 UTC |
| Commit | `e6dd59e` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 4.8 s); `pnpm lint` → pass (exit 0, 11.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.3 s); `pnpm test` → pass (exit 0, 5.9 s); `pnpm test:integration` → pass (exit 0, 23.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.8 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #92 (draft, this push): CI pending at push time |
| Reviewer | round-3 re-review BLOCK (1 MEDIUM residual); disposition below |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/merge.integration.test.ts" --fix-paths packages/db/src/merge.ts` → VERDICT: KILLED (without fix FAIL exit 1, with fix PASS; fix restored byte-identical) |
| Design notes | Every merge/unmerge reparent UPDATE sets version = version + 1, updated_at = clock_timestamp() alongside contact_id (merge moveLinks ×5 tables incl. pre-existing methods bump; unmerge moveBack ×6 versioned tables). interaction_links carries no version column (0037) — verifiably absent, so links move bare (merge recreates fresh rows, no stale readers); tasks untouched by unmerge. Tests: merge asserts conversation version +1; unmerge asserts +2 with restored contact leg. No migration (UPDATE-only, columns exist). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
