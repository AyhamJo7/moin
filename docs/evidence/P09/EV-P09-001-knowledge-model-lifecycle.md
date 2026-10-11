# EV-P09-001: P09.01 knowledge model: items, immutable versions, approvals, 5 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P09-001 |
| Item | P09.01.04 |
| Date (UTC) | 2026-10-11 06:12 UTC |
| Commit | `5899f17` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 23.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 5.1 s); `pnpm lint` → pass (exit 0, 11.6 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.4 s); `pnpm test` → pass (exit 0, 5.9 s); `pnpm test:integration` → pass (exit 0, 24.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.9 s) |
| Result | PASS |
| CI run / artifact | PR #96 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #96) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/knowledge.integration.test.ts" --fix-paths packages/db/src/knowledge.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | 0052 three tables (items shell + versions history + approvals ledger), RLS+FORCE, composite FKs; versions: single guarded draft→approved flip only (no DELETE; UPDATE grant covers the flip, WHERE state='draft' makes approved rows unwritable); approvals append-only. Item lock serialises approves/retires (loser 409s). getLiveVersion reads the live pointer + approved state — drafts (NULL) and retired (cleared) serve nothing. Audit markers only (version_no/scope), never titles/bodies (INV-12). BR-095 metadata: source/location/category/validity/sensitivity/channels/version; Betriebsferien stay in P09.03 opening_exceptions, not the global file. Tests 5 (3x): draft-serves-nothing, approve→edit-keeps-old→approve-flips, illegal transitions, concurrent approve, audit-content + RLS + input rejection. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
