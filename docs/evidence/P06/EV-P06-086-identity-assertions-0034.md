# EV-P06-086: Migration 0034 closes the 0003 assertion gap for moin_identity (presence, api-only attributes, tolerated creator membership only, owns nothing, no table privilege, exact seven-name EXECUTE set, moin_app executes none; TEMPORARY/CREATE is a WARNING on bare databases, pinned as ERROR by catalog section 8 + identity-store CREATE SCHEMA probe on provisioned DBs); regression tests extended (CREATE SCHEMA probe, moin_readonly in matrix)

| Field | Value |
|---|---|
| Evidence ID | EV-P06-086 |
| Item | P06.01.06 |
| Date (UTC) | 2026-10-10 03:50 UTC |
| Commit | `77b475a30a9174908446c28d605073f0bfecc431` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 31.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 2.1 s); `pnpm exec prettier --check .` → pass (exit 0, 6.4 s); `pnpm lint` → pass (exit 0, 15.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 7.8 s); `pnpm test` → pass (exit 0, 8.2 s); `pnpm test:integration` → pass (exit 0, 21.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 8.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.8 s) |
| Result | PASS |
| CI run / artifact | PR #79: `27e993a` 16/16 SUCCESS mergeable MERGEABLE; `fa12798` + `70f0da9` (docs-only) superseded by `51796c2` (round-3 fix), CI queued at push time (this head pending) |
| Reviewer | codex BLOCK round 1 on `c59f8a6` (membership direction, owns-nothing scope, CI staleness) — fixed in `27e993a`; round 2 on `27e993a` (0034 §4 definer-only filter misses explicit non-definer grants) — fixed in `fa12798`; round 3 on `70f0da9` (1 must-fix: §4 grant-set exclusion lets an explicit pg_catalog grant e.g. lo_create pass) — fixed in `51796c2` (no-exclusion seven-name grant set + explicit zero-system-grant assertion; lo_* PUBLIC reachability stays pinned by catalog can_create_large_objects) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
