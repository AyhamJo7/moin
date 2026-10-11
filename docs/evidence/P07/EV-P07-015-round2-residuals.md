# EV-P07-015: ROUND-2 residuals: unmerge restores convos+calls via own columns, pair-unique arbiter, undo full sum

| Field | Value |
|---|---|
| Evidence ID | EV-P07-015 |
| Item | P07.04.04 |
| Date (UTC) | 2026-10-11 03:27 UTC |
| Commit | `f6df63fa90b0926fa30c2933c6adaac49354e0c0` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 23.3 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 4.8 s); `pnpm lint` → pass (exit 0, 11.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.3 s); `pnpm test` → pass (exit 0, 6.0 s); `pnpm test:integration` → pass (exit 0, 23.3 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.9 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | PR #92 (draft, this push): CI pending at push time |
| Reviewer | round-2 re-review BLOCK (3 residuals: 1 HIGH + 1 MEDIUM + 1 LOW); dispositions below |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/merge.integration.test.ts" --fix-paths packages/db/src/merge.ts` → VERDICT: KILLED (without fix FAIL exit 1, with fix PASS; fix restored byte-identical) |
| Design notes | HIGH unmerge restores conversations+calls: ledger gains moved_conversation_ids + moved_call_ids (0049 still unmerged — direct amend, no new migration); moved_link_ids holds only rewritten interaction_link ids; unmerge moves convo/call ids back by UPDATE alongside the link rewrite; test asserts the moved conversation's contact_id names the restored row (task link untouched). MEDIUM concurrent different-value signals: shared insertSignal with SELECT-first fast path + ON CONFLICT on the partial pair-unique arbiter (org,contact_a,contact_b,kind WHERE open+signal-kinds; probe-verified inference, incl. true-collision no-op) + fallback re-read; audit only on actual insert; racing different-value test (Promise.all, same stored row). LOW merge.undo `restored` sums exactly what unmerge moves back (methods+links+convos+calls+leads+requests+notes; tasks observed-not-moved, excluded). Inventory gains the two new columns. Tests 9 (3x stability green). |

Sensitive material is stored by reference only (PLAN.md evidence rules).
