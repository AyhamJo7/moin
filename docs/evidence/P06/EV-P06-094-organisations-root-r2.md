# EV-P06-094: Review round 2 of #250, HIGH F1: the foreign-key check exempts only public.organisations and only the organisation_id to id mapping, not any table named organisations. Completes the scope of EV-P06-093. Before: a single-column and a swapped composite key to an ordinary tenant table r2org.organisations produce no finding (2 of 3 new tests fail; the bound control passes). After: 63/63 catalog tests pass, the migrated schema still has no findings, the CLI exits 1, 1 and 0 for the three cases, and moin_app really writes a tenant A row that points at tenant B for the single-column key. mutation_check.py: KILLED (without fix exit 1, with fix exit 0, record in EV-P06-094-mutation-organisations-root.json).

| Field | Value |
|---|---|
| Evidence ID | EV-P06-094 |
| Item | P06.02.03 |
| Date (UTC) | 2026-11-01 10:57 UTC |
| Commit | `29df9270b0a30d57f44e6bacb479007d228fb0bd` |
| Environment | local clone /tmp/moin-sec01, Node 24.21.0, private compose project implr2 (Postgres 17, moin_app NOSUPERUSER NOBYPASSRLS, moin_migrator NOSUPERUSER) |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.4 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 7.3 s); `pnpm lint` → pass (exit 0, 3.6 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 1.4 s); `pnpm test` → pass (exit 0, 6.3 s); `pnpm test:integration` → pass (exit 0, 63.7 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.4 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
