# EV-P06-079: QG-09 S2 H1 deadlock fix: migration 0027 reorders revokers to advisory, families asc, sessions asc, users last; deterministic AB-BA regression KILLED; catalog digests re-pinned

| Field | Value |
|---|---|
| Evidence ID | EV-P06-079 |
| Item | P06.06.05 |
| Date (UTC) | 2026-10-09 14:04 UTC |
| Commit | `d1153f9be6bda21fb410539e1412012657584bf5` (fix `bac630d01ef9` + AB-BA test shape) |
| Environment | local |
| Command / procedure | `eslint` on the two TS files → exit 0; `prettier --check` on the two TS files → exit 0; `tsc --noEmit -p packages/db/tsconfig.json` → exit 0; `vitest --project integration packages/db/` → 15 files / 232 tests passed (incl. the 2 new tests); new test standalone 20/20 passed; `mutation_check.py` on the new test → KILLED (FAIL without fix exit 1, PASS with fix, byte-identical restore); `.claude/bin/gates.py full` → PASS (control-plane, lint-config, conventions, docs-consistency, migrations, secret-scan; pnpm gates skipped — pnpm missing from gate PATH at run time) |
| Result | PASS (runner) + direct VERIFIED: new regression green, AB-BA mutant KILLED, catalog+lock+identity+isolation 156 green, identity-access+members 131 green, db integration 232 green, 20x stress 20/20 |
| CI run / artifact | PR #70, 16/16 checks passed (integration, RLS catalog, e2e, unit, format/lint/typecheck, secret scan, conventions) |
| Reviewer | pending (control-path: invariant-reviewer + /gate-ready required before merge) |

Sensitive material is stored by reference only (PLAN.md evidence rules).
