# EV-P06-079: QG-09 S2 H1 deadlock fix: migration 0027 reorders revokers to advisory, families asc, sessions asc, users last; deterministic AB-BA regression KILLED; catalog digests re-pinned

| Field | Value |
|---|---|
| Evidence ID | EV-P06-079 |
| Item | P06.06.05 |
| Date (UTC) | 2026-10-09 14:04 UTC |
| Commit | `d1153f9be6bda21fb410539e1412012657584bf5` (fix `bac630d01ef9` + AB-BA test shape) |
| Environment | local |
| Command / procedure | `eslint` on the two TS files → exit 0; `prettier --check` on the two TS files → exit 0; `tsc --noEmit -p packages/db/tsconfig.json` → exit 0; `vitest --project integration packages/db/` → 15 files / 232 tests passed (incl. the 2 new tests); new test standalone 20/20 passed; `mutation_check.py` on the new test → KILLED (FAIL without fix exit 1, PASS with fix, byte-identical restore); `.claude/bin/gates.py full` → PASS (control-plane, lint-config, conventions, docs-consistency, migrations, secret-scan; pnpm gates skipped — pnpm missing from gate PATH at run time) |: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 23.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.7 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → skipped (exit None, 0.0 s); `pnpm lint` → skipped (exit None, 0.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → skipped (exit None, 0.0 s); `pnpm typecheck` → skipped (exit None, 0.0 s); `pnpm test` → skipped (exit None, 0.0 s); `pnpm test:integration` → skipped (exit None, 0.0 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → skipped (exit None, 0.0 s); `node scripts/check-licences.ts` → skipped (exit None, 0.0 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.5 s) |
| Result | PASS (runner) + direct VERIFIED: new regression green, AB-BA mutant KILLED, catalog+lock+identity+isolation 156 green, identity-access+members 131 green, db integration 232 green, 20x stress 20/20 |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
