# EV-P06-081: QG-09 §4 lifecycle remediation (test-only): H1 write-fresh + 30 s read ceiling, M1/M2/M3 + fixation; 12/12 green; L1–L4 KILLED; full gates 14/14

| Field | Value |
|---|---|
| Evidence ID | EV-P06-081 |
| Item | P06.06.07 |
| Date (UTC) | 2026-10-09 18:48 UTC |
| Commit | `5b471891f4ef687198f397fa52a83b1b618de218` (base; change uncommitted at record time, committed below) |
| Environment | local (WSL2, Postgres + OIDC containers; TEST_* URLs from `.env.example` exported, NODE_ENV unset) |
| Command / procedure | `gates.py full` 14/14 PASS (evidence `.git/claude-evidence/20261009T184647Z-full.json`); lifecycle suite 12/12 green; session-mutation sweep L1–L4 each KILLED_ASSERTION (L3 after anchor rename) |
| Result | PASS (test-only; no app code, no migration) |
| CI run / artifact | pending (draft PR) |
| Reviewer | pending founder QG-09 §4 verdict (EV-P06-069 BLOCK stays until founder dispositions) |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## What changed (branch fix/qg09-s4-lifecycle vs base 5b47189; docs + tests only)

- `apps/server/.../session-lifecycle.integration.test.ts` (6 → 12 tests):
  header reconciles the FS-16/cache contract (H1) — mutations resolve fresh
  (`'mutate'` invalidates the key) so a removed member's next write fails at
  once; pure reads are stale at most 30 s (`CONTEXT_CACHE_TTL_MS`), pinned by
  the two new FS-16 tests, not hidden by `clearCache`.
- H1: write-half (first POST after removal 401) + read-half (warm GET still 200
  with no new `lookups`, past-TTL GET 401 with one new lookup) — neither performs
  a cache clear; the old cold-instance FS-16 test is kept and now runs in a
  solo org so last-owner protection (0017) cannot trip it.
- M1: `sign-out-others` empty-set pinned (`{revoked: 0}`, caller survives) +
  supersession-honest shape (HTTP re-login supersedes the presented family, so a
  live-other kill is proven at DB level; the story pins caller-keeps + count).
- M2: rotation test renamed to re-login supersession; non-carried set is the
  predecessor token itself (old cookie 401, successor + cross-user victim 200).
- M3: absolute-expiry pinned via the checkout-wide direct-INSERT pattern
  (created 7 d + 1 s ago → absolute lapsed; idle lapses with it since the slide
  recomputes idle as `LEAST(now+12h, absolute)` — an "idle-valid past absolute"
  row cannot exist, recorded honestly in the test comment).
- Fixation: planted `__Host-moin_sid` pre-login never adopted (server mints its
  own 43-char token; planted cookie 401, issued cookie 200).
- Fixtures: `soloOrg`/`soloPair` (actor + keeper per fresh org) for every
  removal-sensitive test; shared-ORG `person()` kept elsewhere.
- `docs/verification/session-mutation-manifest.json`: L3 anchor renamed to the
  new test title (one line; no mutant change).

## Verification state

- Lifecycle suite standalone: 12/12 green (this session).
- `gates.py full`: 14/14 PASS (evidence `20261009T184647Z-full.json`).
- Mutation sweep (session manifest, each run singly after a stale-lock clear):
  L1 CSRF-guard KILLED_ASSERTION; L2 idle-expiry KILLED_ASSERTION; L3
  supersede-unscoped KILLED_ASSERTION (after the anchor rename — the sweep
  reported BASELINE_FAILED on the stale title first, proving the rename was
  load-bearing); L4 removed-member KILLED_ASSERTION (store-level anchor,
  unchanged — the HTTP FS-16 tests pin the same JOIN through the guard).
- New tests carry no new manifest mutants (test-only task; L1–L4 re-proven
  against the renamed suite). EV-P06-052 L1–L4 artifact gap: L1–L3 kill in this
  file via the sweep above; L4 kills in `identity-store.integration.test.ts`
  (`admits no membership-less session`), same JOIN.
- `evidence.py check`: 162 OK; sole STALE is EV-P06-054's pre-squash commit
  `0748a86` (pre-existing evidence-record defect, founder-owned).
- No app code, no migration, no prod behaviour changed. QG-09 §4 BLOCK (EV-P06-069)
  is the reviewers' static verdict; this record is runtime proof for the founder
  to disposition, not a unilateral unblock.
