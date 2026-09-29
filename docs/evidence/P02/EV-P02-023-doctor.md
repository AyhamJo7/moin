# EV-P02-023: pnpm doctor checks Node, pnpm, Docker, dependencies, env completeness and ports

| Field | Value |
|---|---|
| Evidence ID | EV-P02-023 |
| Item | P02.04.05 |
| Date (UTC) | 2026-09-28 13:09 UTC |
| Commit | `adbe336fea37b1cf83e27b27cd928044e117afe4` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | node scripts/doctor.ts reports all six checks and every failure at once rather than stopping at the first. Observed output on the fresh clone: node v24.21.0 ok; pnpm 10.34.5 ok; docker daemon 29.8.0 ok; dependencies installed ok; env FAIL "no .env" with the fix "Run cp .env.example .env"; ports ok ("in use by the local stack, which is running" — it distinguishes the stack holding its own ports from a foreign process such as a system Postgres on 5432). Exit code 1 when any check fails, 0 when all pass. The env check compares key names only, never values, so its output is safe to paste into an issue (INV-15). |
| Result | PASS — the one genuine gap on this machine was detected and explained. The Docker check was also exercised in its failing state earlier in this phase, when the daemon was unreachable: it reports "client present, daemon unreachable" and names the WSL2 integration setting. |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).
