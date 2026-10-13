# EV-P12-002: routeUtterance utterance-to-turn-action (answer/ask_slot/create/escalate/transfer/fallback) + 0.5 low-confidence gate to unknown (T-22); mirrors decide table voice-side, no new package edge; routing + low-conf + passthrough tests; unit 49/49 3x + integration green in gates; mutation KILLED; gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P12-002 |
| Item | P12.02.05 |
| Date (UTC) | 2026-10-13 23:16 UTC |
| Commit | `4dbe4486f87237a4c0822a849ac7c15866c21b24` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.7 s); `pnpm exec prettier --check .` → pass (exit 0, 7.0 s); `pnpm lint` → pass (exit 0, 10.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 3.5 s); `pnpm test` → pass (exit 0, 7.0 s); `pnpm test:integration` → pass (exit 0, 28.7 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 2.8 s); `node scripts/check-licences.ts` → pass (exit 0, 0.5 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.3 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
