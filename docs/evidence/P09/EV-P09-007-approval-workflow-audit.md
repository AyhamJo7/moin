# EV-P09-007: P09.05 approval workflow: role gate, hash binding, bulk per-item, 5 tests

| Field | Value |
|---|---|
| Evidence ID | EV-P09-007 |
| Item | P09.05.03 |
| Date (UTC) | 2026-10-11 16:02 UTC |
| Commit | `bc6665d` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 24.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 5.2 s); `pnpm lint` → pass (exit 0, 12.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 5.8 s); `pnpm test` → pass (exit 0, 6.2 s); `pnpm test:integration` → pass (exit 0, 20.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.9 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.0 s) |
| Result | PASS |
| CI run / artifact | PR #100 (draft, this push): CI pending at push time |
| Reviewer | pending (review requested on PR #100) |

| Mutation | `mutation_check.py --test "… vitest run --project integration packages/db/src/approval.integration.test.ts" --fix-paths packages/db/src/approval.ts` → VERDICT: KILLED (without fix FAIL, with fix PASS; fix restored byte-identical) |
| Design notes | 0056 alters knowledge_approvals (approver_role + version_hash + decided_at; pre-existing rows stay NULL — backfilling role/hash would fabricate evidence) + DEFINER body replaced (role resolve + sha256-content-binding via pgcrypto digest() precedent + stamped ledger; digest facdadcc… re-pinned). Role is the OUTER gate (service pre-check → 403 even on stale versions; fn re-checks in-txn — direct calls cannot skip). Stale drafts 409 via latest-check (fn + service). Bulk = sequential per-item results (approved/conflict/forbidden/error), failures never abort, one bulk audit row (counts only). Audit markers only (INV-12). Knowledge tests re-seeded (STAFF as admin member — role coverage in approval tests). Inventory rows for the three columns. Tests 5 (3x): owner/admin stamp+hash, staff-403-nothing-published, stale-409, bulk per-item, audit-markers + cross-tenant refusal. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
