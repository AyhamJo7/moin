# EV-P06-022: Per-tenant sequence and hash chain over a stored canonical payload

| Field | Value |
|---|---|
| Evidence ID | EV-P06-022 |
| Item | P06.10.02 |
| Date (UTC) | 2026-09-30 14:02 UTC |
| Commit | `8e5bf76f5ac9ec00e2394036927aefb092d5b763` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 20.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 2.4 s); `pnpm lint` → pass (exit 0, 7.0 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.7 s); `pnpm typecheck` → pass (exit 0, 4.2 s); `pnpm test` → pass (exit 0, 4.7 s); `pnpm test:integration` → pass (exit 0, 4.4 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.5 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.4 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

Standalone real-PostgreSQL run: `packages/db/src/audit.integration.test.ts` 11/11.

Each tenant has its own head row and its own gap-free sequence: two tenants writing independently
both start at 1. The head is taken `FOR UPDATE` in the writer's transaction, so concurrent appends
serialise at the chain head rather than racing — asserted under concurrency, with the head left
aligned with the last event. A duplicate event id fails the whole append and leaves the prior chain
state untouched.

The hash covers the previous hash plus the stored canonical payload's UTF-8 bytes. The payload is
stored beside the structured columns and rebuilt from them during verification, so a changed column
is detected as `payload-mismatch` and a changed payload or reordered chain as `hash-mismatch`. The
verifier captures the head at entry, which is why a concurrent append does not raise a false alarm:
committed rows cannot change, so the captured head names an immutable prefix.
