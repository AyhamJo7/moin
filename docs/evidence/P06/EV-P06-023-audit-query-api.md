# EV-P06-023: Tenant-scoped audit query by target, actor and correlation ID

| Field | Value |
|---|---|
| Evidence ID | EV-P06-023 |
| Item | P06.10.04 |
| Date (UTC) | 2026-09-30 14:02 UTC |
| Commit | `8e5bf76f5ac9ec00e2394036927aefb092d5b763` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 7.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 4.2 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 4.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

Standalone real-PostgreSQL run: `packages/db/src/audit.integration.test.ts` 11/11.

`listAuditEvents` filters by target kind, target id, actor id and correlation id, pages by `seq` and
runs entirely under tenant RLS — a query issued for one tenant returns none of another's events even
when given the other's identifiers. Filters are values, never SQL identifiers; there is no dynamic
SQL in the query.

Every filter is validated at the boundary and a malformed one is refused **without echoing the
input** (INV-12), because a malformed identifier is usually attacker-supplied. The limit is capped at
100 and `afterSeq` is bounded by PostgreSQL's `bigint` range, so a caller cannot request an unbounded
page or overflow the cursor.
