# EV-P17-002: hardeningComplete all-required + hardeningOpen names gaps; MFA/root-keys/encryption/IMDSv2; console work stays founder-driven; unit 2/2 3x + mutation KILLED + gates full 14/14.

| Field | Value |
|---|---|
| Evidence ID | EV-P17-002 |
| Item | P17.02.01 |
| Date (UTC) | 2026-10-15 01:59 UTC |
| Commit | `388daf6e3719d53b6c96aaeef8e6a196067112b6` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.2 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.8 s); `pnpm exec prettier --check .` → pass (exit 0, 7.9 s); `pnpm lint` → pass (exit 0, 11.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.3 s); `pnpm typecheck` → pass (exit 0, 5.5 s); `pnpm test` → pass (exit 0, 7.5 s); `pnpm test:integration` → pass (exit 0, 23.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.4 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
