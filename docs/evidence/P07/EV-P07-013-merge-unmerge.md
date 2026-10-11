# EV-P07-013: duplicate candidates plus human merge unmerge plus 6 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P07-013 |
| Item | P07.04.01 |
| Date (UTC) | 2026-10-11 02:51 UTC |
| Commit | `9d66c35aa65607a414cde8785bda01d59b8cc2c7` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full` 14/14 PASS (evidence `20261011T024928Z-full.json`, on this head); merge suite 6/6 green standalone; LEGACY-DUMP: `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.5 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.8 s); `pnpm exec prettier --check .` → pass (exit 0, 5.8 s); `pnpm lint` → pass (exit 0, 15.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 6.3 s); `pnpm test` → pass (exit 0, 6.4 s); `pnpm test:integration` → pass (exit 0, 22.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.1 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #92 (draft, this push): CI pending at push time |
| Reviewer | pending (codex review requested on PR #92) |

| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/merge.integration.test.ts" --fix-paths packages/db/src/merge.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | Extends 0037 inbox (signal columns + widened kind CHECK via NOT VALID in 0049 + VALIDATE in 0050); new contact_merges ledger (RLS+FORCE, no DELETE, append-only). No new DEFINER. Inbox is a worklist: resolved suggestions are consumed (CASCADE with loser delete, verified by probe), ledger + audit keep the evidence. INV-09: AI flag suggestion-only, merges human-approved always. |
