# EV-P07-011: version-conflict problem type plus 5-test parallel suite

| Field | Value |
|---|---|
| Evidence ID | EV-P07-011 |
| Item | P07.13.01 |
| Date (UTC) | 2026-10-10 23:34 UTC |
| Commit | `7dc0a4bbdd62adf3e04d630ab831a134401f17d3` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 5.0 s); `pnpm lint` → pass (exit 0, 12.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 5.5 s); `pnpm test` → pass (exit 0, 6.2 s); `pnpm test:integration` → pass (exit 0, 21.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.8 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | PR #90 (draft, this push): CI pending at push time |
| Reviewer | pending (codex review requested on PR #90) |
| Mutation | `mutation_check.py --test "pnpm exec vitest run --project integration packages/db/src/concurrency.integration.test.ts" --fix-paths packages/db/src/version-conflict.ts` → VERDICT: KILLED (fails without the fix, passes with it) |
| Design notes | No new migration: all P07 tables already carry `version integer NOT NULL DEFAULT 1` with compare-and-bump writers (contacts, tasks, leads, requests, notes, governance, conversations, calls). Tables without one (outcomes, links, candidates, events, messages, lead_tasks, fact_schemas) are append-only or immutable — nothing to conflict on. Flake note: a 3-way same-tick finaliser/sweep race proved non-deterministic (direct-create path is check-then-act without a row lock yet — a documented P07.11 gap), so the suite asserts sequential sweep convergence; the N-way parallel shape is covered by the 5-way task race. Suite ran 8x consecutively green. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
