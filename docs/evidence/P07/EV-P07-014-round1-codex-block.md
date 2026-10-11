# EV-P07-014: ROUND-1 codex BLOCK 6 findings: triple-FK delete+recreate, task no-touch, unmerge serialisation, pair-scoped signals, candidate check, audit sum

| Field | Value |
|---|---|
| Evidence ID | EV-P07-014 |
| Item | P07.04.04 |
| Date (UTC) | 2026-10-11 03:13 UTC |
| Commit | `26d1345` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 23.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 5.0 s); `pnpm lint` → pass (exit 0, 3.6 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 1.2 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 22.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.9 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #92 (draft, this push): CI pending at push time |
| Reviewer | codex ROUND-1 BLOCK (6 findings: 3 HIGH + 2 MEDIUM + 1 LOW); reviewer dispositions below |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/merge.integration.test.ts" --fix-paths packages/db/src/merge.ts` → VERDICT: KILLED (without fix FAIL exit 1, with fix PASS; fix restored byte-identical) |
| Design notes | Triple-FK: 0038 immediate + non-deferrable, so neither UPDATE order satisfies it mid-move — links DELETE+recreate both directions (merge loser→winner, unmerge winner→restored), rule/label/ref verbatim, ledger records rewritten ids. Tasks: ledger observes task ids on moved conversations for the audit count but never moves/touches them (merge and unmerge). Unmerge serialised: ledger FOR UPDATE + conditional `undone = false` UPDATE returning row, second 409s. Signals: SELECT-first + pair-scoped value (ordered pair in the value, 0037 value-unique arbiter) + fallback re-read; no partial-index arbiter; re-suggest returns stored row without audit. Candidate validated before any move: open + exact ordered pair, else 409. Audit `moved` sums all arrays (methods+links+convos+calls+tasks+leads+requests+notes). Tests 8: signal idempotency + changed-signal + different-pair; merge moves incl. interaction_link verdict carry; candidate-mismatch 409 with nothing moved; concurrent merge 409; new-interaction FK; unmerge restore incl. task-conversation intact; concurrent unmerge 409; cross-tenant. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
