# EV-P13-014: M1 vertical slice: simulated callback call to tenant callback task to the owner's Heute view; Heute empty states

| Field | Value |
|---|---|
| Evidence ID | EV-P13-014 |
| Item | P13.02.03 |
| Date (UTC) | 2026-10-16 22:46 UTC |
| Commit | `c6dc83f9352dcd3b8b5a71c1a3fa6514f97d4032` (working tree had uncommitted changes) |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.2 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.6 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 6.6 s); `pnpm lint` → pass (exit 0, 11.9 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 1.1 s); `pnpm typecheck` → pass (exit 0, 5.6 s); `pnpm test` → pass (exit 0, 6.1 s); `pnpm test:integration` → pass (exit 0, 29.6 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 4.1 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 1.2 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What this record shows

**P13.02.03 (met):** every Heute section that has no live task shows "Alles erledigt.", never a
blank area. When the API truncated the list, an empty section reads "In dieser Auswahl keine."
instead, because the claim would not hold. Shown by the rendered page in the local browser test
(the Rückrufe section reads "Alles erledigt." before the call) and by the page source
(`apps/web/app/page.tsx`).

**M1 vertical slice (context; these items stay IN_PROGRESS):** a simulated callback call becomes
a tenant-scoped callback task, and the signed-in owner sees it on Heute.

- Path: `POST /api/dev/simulated-calls` (development and test only) → number route →
  `captureCallbackRequest` (one transaction: call, outcome, task) → `GET /api/today` (session
  tenant) → server-rendered Heute. See `docs/development/m1-vertical-slice.md`.
- Partly covered: P12.09.01 (deterministic summary, simulator path only), P12.12.01 (no contact
  resolution, no SSE), P13.02.01 (sections exist; only task types map to them), P13.02.04 (the
  browser test shows the task within 60 s after a reload; it uses the development entry point,
  not the protocol simulator, and is not in CI).

## Tests

- `gates.py full` above: unit 988/988, integration 751/751.
- API integration (`apps/server/src/modules/work/callback-today.integration.test.ts`, real
  PostgreSQL as `moin_app`):
  - persistence, the owner read and contract agreement;
  - the other tenant, and a forged tenant selector;
  - fail closed: no session, unknown or quarantined number, a body naming a tenant, missing or
    wrong token, the route unconfigured, an unusable callback number, an unsupported request;
  - replay and concurrent delivery;
  - calls first recorded by another path, and done or cancelled finaliser fallbacks;
  - live-only filtering, urgent-first truncation, emoji titles, and an API restart.
- Cross-tenant suite: both routes inventoried (21 routes) and probed.
- Mutation checks (scratch script, each mutant restored from a saved copy): 13 mutants, 12 killed,
  1 equivalent ("take the first of several routes": `number_routes.e164` is the primary key).
- Browser (local only): `pnpm exec playwright test -c playwright.slice.config.ts`, 1/1 passed.
  It covers the real Keycloak login form, a simulated call for each of two tenants, the task with
  caller, time and status in Rückrufe, the other tenant's task absent, axe with no violations, an
  API process restart and a reload.

## Reviews

QG-09 security, architecture and invariant reviews, and one advisory review. No CRITICAL finding
was raised. Fixed with tests:

- the advisory review's HIGH: a closed finaliser fallback absorbed a new callback;
- its MEDIUM: the 100-task limit could hide older urgent work;
- architecture M2–M5: replay judged by the capture's own key under the finaliser's lock; one
  title-length unit; the request's correlation id; no force-drop of the shared template;
- security L2–L4: the per-account throttle on Today; loopback-only build proxy; HTTPS or
  loopback only for the session cookie.

Security L1 is partly addressed: the inert route now answers exactly like an unmounted one.
Open, none HIGH: architecture M1 (the guards cross into the identity module), L1–L3, and the
invariant review's LOW (one CallSid, two tenants). See `docs/development/m1-vertical-slice.md`.
