# EV-P06-093: Review round 1 of #250, HIGH F1: the foreign-key query in the RLS catalog check now covers the same schemas as the table inventory. Completes the F2 and F3 scope of EV-P06-087. Before: with the public-only filter restored, the swapped-key and the missing-tenant-column cases for a child table in another schema produce no finding (2 of 3 new tests fail; the bound-key control passes). After: 60/60 catalog tests pass, swapped key is foreign-key-tenant-mismapped and the catalog CLI exits non-zero, bound key exits 0. mutation_check.py: KILLED (without fix exit 1, with fix exit 0, record in EV-P06-093-mutation-fk-other-schema.json). The real moin_app writes a tenant A row pointing at tenant B in the swapped case.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-093 |
| Item | P06.02.03 |
| Date (UTC) | 2026-11-01 10:09 UTC |
| Commit | `98e0f2fcd52148dc9f5c7f627e8fdb560054d946` |
| Environment | local clone /tmp/moin-sec01, Node 24.21.0, private compose project implr1 (Postgres 17, moin_app NOSUPERUSER NOBYPASSRLS, moin_migrator NOSUPERUSER) |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.5 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 7.1 s); `pnpm lint` → pass (exit 0, 3.5 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 6.2 s); `pnpm test` → pass (exit 0, 6.2 s); `pnpm test:integration` → pass (exit 0, 64.7 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
