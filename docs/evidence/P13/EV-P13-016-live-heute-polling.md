# EV-P13-016: M2B: an open Heute polls the authenticated Today read and re-renders on change; a new callback appears without reload (14.97 s measured, local browser test), a completion reaches another session, outage and revoked-session behaviour pinned

| Field | Value |
|---|---|
| Evidence ID | EV-P13-016 |
| Item | P13.02.04 |
| Date (UTC) | 2026-10-17 21:08 UTC |
| Commit | `7d967ad5e717dfb9874ad973ed67f3df8ce01dd4` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 27.6 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.3 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.8 s); `pnpm exec prettier --check .` → pass (exit 0, 7.8 s); `pnpm lint` → pass (exit 0, 4.2 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.3 s); `pnpm typecheck` → pass (exit 0, 1.3 s); `pnpm test` → pass (exit 0, 7.5 s); `pnpm test:integration` → pass (exit 0, 29.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.6 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

Mission M2B, starting from `main` at `7caad73` (M2A #233 squash-merged). P13.02.04 and P13.10 stay
open; nothing here is VERIFIED, and no pilot or production readiness is claimed.

**Existing infrastructure.** Operational: session/tenant guards, `GET /api/today` with its shared
contract, per-account throttle (50/min), task `version`, `router.refresh` re-reads after Erledigt.
Implemented but not wired: `apps/web/lib/realtime.ts` (pure state helpers for P13.10). Missing: any
server-side SSE, WebSocket, event stream, outbox or `LISTEN/NOTIFY` use.

**Choice: bounded polling.** No event source exists, and a push channel would be a new
authenticated surface. A visible tab polls `GET /api/today` every 15 s (±10 %) from the browser
(HttpOnly session cookie, same origin) and calls `router.refresh()` only when the answer's
fingerprint differs from the rendered one. The list on screen is always the server's rendering.

**Runtime path.** simulated call → callback task (M1) → open Heute's next poll sees a new fingerprint
→ `router.refresh()` → server component reads `/api/today` with the session cookie → card appears,
keyed by task id. Erledigt (M2A) → task leaves the list → another session's next poll differs → it
re-renders.

**Boundaries.** Tenant comes from the session on the API (INV-02), FORCE RLS unchanged, no new route,
no migration, no cookie or token in a URL, `no-store` responses, `connect-src 'self'`. The
fingerprint is compared in memory only. Inactivity: every guarded read slides the session idle
expiry, so a tab without input for 30 min stops polling (found in review, fixed in `7d967ad`).

**Failure and recovery.** A failed poll (network, 429, 5xx, bad body, throw) keeps the list and backs
off 15 s → 120 s; polls never overlap; a hidden tab does not poll and polls at once when shown or
when the browser reports `online`; a 401 triggers a server render (signed-out page, no task data)
and is retried with backoff if the page stays. Reconciliation reads the current state, not missed
events. Nothing is promised for a hidden/suspended tab or while disconnected.

## Measured latency (local browser, real PostgreSQL, Keycloak login, compiled API, standalone app)

Task row `created_at` (Postgres) to the card visible in Chromium, same host clock; final run
2026-10-17 21:0x UTC, `test-results/live-today-timings.jsonl` (local, untracked):

| Scenario | Latency |
| --- | --- |
| New callback on an already-open Heute | 14.97 s (first run 15.45 s) |
| Completion in one session reaching a second, independently signed-in session | 15.36 s (first run 15.36 s) |
| Network returns after an outage (`online` event) | 0.09 s |

The limit is 60 s; the expected worst case is one interval plus a request and a render (about 17 s).

## Tests and what each proves

Unit (`apps/web/lib/live-today.test.ts`, 14): fingerprint changes; the poll's request shape and
failure mapping; backoff and cap; re-render only on difference; error state recovers; no overlap;
failures keep the list; hidden tab silent and woken; 401 handover and retry; throwing poll; stop
ignores a late answer; idle window.

Browser (`e2e/vertical-slice/today-callback.spec.ts`, 10 of 10 pass, local only): arrival without
reload (performance mark survives, focus kept), exactly one card after further polls, the other
tenant's task never shown; completion reaches a second session and a replay of the original call
reopens nothing; outage keeps the list and shows no error, then reconciles on return; a revoked
session shows the signed-out page with no task data. Earlier M1/M2A tests still pass (J2 replay,
J3 and M2A concurrency stay in the integration suite: `gates full` integration PASS).

**Mutation.** `mutation_check.py --fix-paths apps/web/app/page.tsx` with the arrival test: KILLED
(fails without the wiring in 75 s, passes with it in 48 s), at `40c1bc1`.

**Reviews (QG-09).** Security review: no Critical/High; M1 (polling slides idle expiry) fixed with
the 30-minute input window; L1 (shared throttle bucket: 429 shows the error state until the next
good poll) and L2 (no cross-tab dedupe) accepted for now; L3 (30 s membership cache) informational.
Architecture review: no Critical/High; M3 (401 ended the loop), L1 (ref written in render) and L2
(throwing poll) fixed; M1 (no gate for P13.10 SSE) and M2 (no last-success signal for the stale
indicator) recorded as P13.10 work. Invariant review not run: no control path changed.

## Limits and roadmap gaps

Polling cost is about 4 reads a minute per visible tab against 50 a minute per account. The browser
suite needs Keycloak and runs locally only; CI does not cover it. A tab idle for 30 minutes or
hidden goes stale until the next input or show. Open: SSE with `Last-Event-ID` (P13.10.01), polling
as fallback only, stale indicator after 2 minutes (P13.10.02), its E2E (P13.10.03), summary counts
(P13.02.02), P13.02.04 in CI. The M2A warning stands: the strict Today schema needs the API and the
owner app deployed together; this change adds no wire change.
