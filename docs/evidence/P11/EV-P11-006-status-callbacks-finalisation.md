# EV-P11-006: createFinaliser dedup by CallSid-status-sequence + monotonic ladder + terminal-once; 6-permutation FS-01 test + 3x duplicates + late-callback refusal + terminal siblings; unit 24/24 3x + integration green in gates; mutation KILLED; gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P11-006 |
| Item | P11.06.04 |
| Date (UTC) | 2026-10-13 19:19 UTC |
| Commit | `519143633afcf9b48d86441e4c1799d0fb163343` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.3 s); `pnpm lint` → pass (exit 0, 7.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 3.1 s); `pnpm test` → pass (exit 0, 5.8 s); `pnpm test:integration` → pass (exit 0, 24.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 2.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
