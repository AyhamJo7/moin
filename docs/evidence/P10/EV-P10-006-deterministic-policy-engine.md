# EV-P10-006: decide pure fn: tenant-config + context + NLU to ask_slot/answer/create/escalate/transfer/fallback/end + reason codes; enabled-intent, after-hours bool, entitlement, unsupported-escalation BR-125/127; exhaustive tables + 200+ INV-05 no-commit property; gateway 27/27 3x green, mutation KILLED, gates 9/14 (integration env-blocked, DB-free slice)

| Field | Value |
|---|---|
| Evidence ID | EV-P10-006 |
| Item | P10.07.04 |
| Date (UTC) | 2026-10-13 14:51 UTC |
| Commit | `cd387390d78cc759978d52325167718922ffc44b` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.0 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 5.2 s); `pnpm lint` → pass (exit 0, 5.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.0 s); `pnpm typecheck` → pass (exit 0, 2.5 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → fail (exit 1, 0.5 s); `node scripts/check-migrations.ts` → skipped (exit None, 0.0 s); `pnpm turbo run build` → skipped (exit None, 0.0 s); `node scripts/check-licences.ts` → skipped (exit None, 0.0 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → skipped (exit None, 0.0 s) |
| Result | FAIL (SKIPPED-UNVERIFIED: migrations, build, licences, secret-scan) |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
