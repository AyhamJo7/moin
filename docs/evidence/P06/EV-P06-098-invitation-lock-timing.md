# EV-P06-098: The invitation-lock expiry case waited a fixed 5 s on the process timer while the function judges expiry on the database wall clock, so on a host whose wall clock lags (WSL2) the waiter could be admitted before the 4 s deadline. Before: 4 of 20 standalone runs and 4 of 20 runs of the identity-access folder failed with expected 'accepted' to be 'expired'. After: 20 of 20 standalone and 20 of 20 in the folder. The case now waits for the consumer to block on the lock, asserts the database clock is still before the deadline, and holds until the database clock passes it. The function is correct; judging expiry at transaction start (now() instead of clock_timestamp()) still fails the case. A separate flake was seen once in the folder run: sign-in.integration.test.ts 'issues one opaque session cookie' expected Max-Age 604799 to be 604800; not fixed here.

| Field | Value |
|---|---|
| Evidence ID | EV-P06-098 |
| Item | P06.08.01 |
| Date (UTC) | 2026-11-01 14:48 UTC |
| Commit | `849edca59f5d72c4297b745922cca884dbbe1ae3` |
| Environment | local clone /tmp/moin-flaky, Node 24.21.0, private compose project implflaky (Postgres 17, moin_app NOSUPERUSER); WSL2 wall clock lags the monotonic clock |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 26.1 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 1.4 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 7.2 s); `pnpm lint` → pass (exit 0, 11.7 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 6.4 s); `pnpm test` → pass (exit 0, 6.6 s); `pnpm test:integration` → pass (exit 0, 63.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
