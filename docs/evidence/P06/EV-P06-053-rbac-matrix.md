# EV-P06-053: RBAC matrix, role guard, last-owner trigger; route x role matrix tests; 4/4 B mutants kill; full gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P06-053 |
| Item | P06.07.01 |
| Date (UTC) | 2026-10-07 18:27 UTC |
| Commit | `ff43a7338126efbee144f1f161e0ed4f40be1fe7` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.9 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 3.6 s); `pnpm lint` → pass (exit 0, 6.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 3.7 s); `pnpm test` → pass (exit 0, 5.9 s); `pnpm test:integration` → pass (exit 0, 18.9 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 0.3 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.8 s) |
| Result | PASS |
| CI run / artifact | pending (PR to be opened as draft) |
| Reviewer | pending QG-09 triad at final SHA (security, architecture, invariant) |
| Mutation sweep | 4/4 B variants KILLED_ASSERTION (B1–B4, measured this session); B1/B2 share the disabled-cover test after proving single-owner fixtures cannot distinguish the status predicate; B3 fixed from a no-op (x && true) to dropping the check; 87-variant manifest resolves |
| Scope note | No resource routes exist yet: the 404 rule (P06.07.03) binds future P06.08+ routes and is documented in access-matrix.md with the guard/service/RLS layering; the cross-tenant suite (P06.13) exercises it per route. Service checks land as requireCapability (P06.08 routes will call it). |
| QG-09 status | NOT re-run at this SHA. Required before READY_FOR_REVIEW. |

Sensitive material is stored by reference only (PLAN.md evidence rules).
