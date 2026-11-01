# EV-P06-091: Audit feed and SSE replay order by the numeric column, not the text cast; mutation KILLED for both

| Field | Value |
|---|---|
| Evidence ID | EV-P06-091 |
| Item | P06.10.04 |
| Date (UTC) | 2026-11-01 04:18 UTC |
| Commit | `44fbcdeca592f79f0e5c2010a94afbe2b2f0b0f8` |
| Environment | Node 24.21.0, PostgreSQL 17 (pgvector) as a private compose project, local worktree /tmp/moin-sec04 |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 25.7 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 7.0 s); `pnpm lint` → pass (exit 0, 3.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 1.1 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 64.8 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 5.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.1 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What it proves

Finding F1 (HIGH) of the independent security acceptance review of group 4 (be4591d): the audit feed selected `seq::text as seq` and `ORDER BY seq` sorted that text, so with twelve events `afterSeq = '2'`, `limit = 3` returned 10, 11, 12 and a client advancing its cursor never saw events 3 to 9.

| Change | Commit | Regression test | Before | Mutation |
|---|---|---|---|---|
| audit feed orders by `audit_events.seq` (the API still returns the string) | `0ec2b0b` | `packages/db/src/audit.integration.test.ts` (SEC-G04), as `moin_app`: twelve events for one tenant plus a control tenant; the page after 2 is 3, 4, 5; paging from 0 with limit 2 returns all twelve once, in order, no foreign events | 2 failed (`['10','11','12']`) | `EV-P06-091-mutation-audit-feed.json`: KILLED |
| SSE replay orders by `sse_events.event_id`: the same pattern found by scanning every query that orders by a text-cast output | `8dab76e` | `packages/db/src/sse.integration.test.ts`: identity restarted at 8 so twelve events cross the digit boundary; the page after 7 is 8, 9, 10 | failed | `EV-P06-091-mutation-sse-replay.json`: KILLED |
| hours exceptions and dead-job list order by their table columns (date and timestamp text; ordering is equal today, so a defensive change with no behaviour change) | `44fbcde` | existing tests for both lists pass | n/a | n/a |

The scan (all non-test queries under `packages/*/src` and `apps/*/src`) found twelve queries ordering by a column they also cast to text. Eight order by a uuid, whose text order equals its uuid order (conflicts, retrieval, outbox, jobs, staleness); they are unchanged. The timers query is a false positive: its inner select does not cast.

## Not shown

Independent re-review pending; nothing is VERIFIED. `gates.py full` passed 14/14 at `44fbcde` on the second run; the first run failed once at unit on `packages/db/src/readiness.test.ts`, a cache-TTL timing test this change does not touch, which passes 6 of 6 standalone.
