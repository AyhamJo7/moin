# EV-P06-109: Security acceptance G10 M1 to M4. M1: moin_app could insert, un-revoke and extend support grants with plain SQL and no audit row; INSERT and UPDATE are revoked (migration 0080), writes go through the two audited definer functions. M2: the cap of five live grants was an unlocked count; twelve parallel creates left ten live grants and two 500s; create now takes a per-organisation advisory lock before it counts (after: 5 created, 7 refused 409, 5 live). M3: hours 72 always failed the 72 hour check by microseconds; one clock_timestamp now supplies created_at and expires_at; quota and parameter refusals answer 409 and 400 instead of 500. M4: a superseded grant now has its own support.grant_revoke audit row. Five regression tests fail without the migration and controller change and pass with them; mutation_check KILLED; stress 20 of 20; gates full PASS 14/14. Not done here: M5 (trusted operator identity in read audit rows) needs the operator session of P06.11.01 (P05/EXT-09), and L1 (rewrite the gate tests to call the real function body) is left open; no runtime role may execute a support read.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-109 |
| Item | P06.11.02 |
| Date (UTC) | 2026-11-03 15:15 UTC |
| Commit | `c83a089bb24481385b7ea7360260bb14e2f36976` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.6 s); `pnpm exec prettier --check .` → pass (exit 0, 7.7 s); `pnpm lint` → pass (exit 0, 12.8 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.2 s); `pnpm typecheck` → pass (exit 0, 6.5 s); `pnpm test` → pass (exit 0, 6.4 s); `pnpm test:integration` → pass (exit 0, 63.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
