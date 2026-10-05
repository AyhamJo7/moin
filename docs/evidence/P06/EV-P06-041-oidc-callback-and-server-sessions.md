# EV-P06-041: Authorization Code + PKCE S256 callback with single-use browser-bound state, nonce-bound ID token (jose), sealed provider tokens; sessions keyed by SHA-256 of a 256-bit token in __Host-moin_sid, 12 h idle / 7 d absolute, rotation primitive; real moin-web code flow against local Keycloak; 21/21 mutation variants KILLED_ASSERTION; KMS custody and Cognito open

| Field | Value |
|---|---|
| Evidence ID | EV-P06-041 |
| Item | P06.06.01, P06.06.02 |
| Date (UTC) | 2026-10-02 14:50 UTC |
| Commit | `65e08650f95dbbeb45516a134dc6b1bd2d1c85c3` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 21.8 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.2 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.4 s); `pnpm exec prettier --check .` → pass (exit 0, 3.3 s); `pnpm lint` → pass (exit 0, 9.4 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 4.5 s); `pnpm test` → pass (exit 0, 5.4 s); `pnpm test:integration` → pass (exit 0, 11.2 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 3.7 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.6 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## Scope

P06.06.01 ("Authorization Code + PKCE callback in `api`; `state` + nonce validation; Cognito tokens
encrypted server-side") and P06.06.02 ("`sessions` table (token hash), cookie `__Host-moin_sid`;
idle 12 h, absolute 7 days (T-15); rotation on login, step-up and privilege change"), against the
local provider. Base `e1d787c` (PR #34). Design and residual risks: `docs/security/sessions.md`.

Not built and not claimed: P06.06.03 (per-request membership re-check), P06.06.04 (step-up policy
and its rotation caller), P06.06.05 (revocation callers), P06.06.06 (CSRF), P06.06.07 (lifecycle
acceptance suite, FS-16), P06.07, P06.08 (user creation), P06.09.02, P06.10.03 audit adoption (no
audit event is written: sessions are not tenant events and no operation is registered). EV-P06-003
is unrelated to this record and is not claimed.

## Architecture audit (main at `e1d787c`)

- No `users`, `memberships` or `sessions` existed. This change adds `users` exactly as Data
  Architecture defines it (`id`, `cognito_sub` UNIQUE, `email` citext, `status`), with no runtime
  grant; rows are created by P06.08.02, never by sign-in. `memberships` are not created.
- `sessions` follows the Data Architecture row (`token_hash` PK, `user_id`, `idle_expires_at`,
  `absolute_expires_at`, `revoked_at`, `revocation_reason`) plus `id`, `family_id`,
  `rotated_from`, `rotation_reason`, `created_at`, `last_seen_at` and the sealed provider tokens.
  `active_organisation_id` and `step_up_at` are deferred to P06.06.03 and P06.06.04, which set them.
- Access pattern is PLAN's: global tables, no `moin_app` table privilege, allowlisted `SECURITY
  DEFINER` functions pinned by signature, owner, `search_path`, grants and body digest.
- No crypto abstraction existed; AES-256-GCM from `node:crypto` was added. No JWT library existed;
  `jose` 6.2.12 (zero dependencies, MIT) was added for signature and claim verification.
- Committed `moin-web`: confidential, standard flow only, PKCE `S256`, no direct grants, redirect
  `http://localhost:3000/*`; `OIDC_REDIRECT_URI=http://localhost:3000/api/auth/callback`.

## Results

| Check | Command | Result |
| --- | --- | --- |
| Gates at `65e0865` | `python3 .claude/bin/gates.py full`, clean tree | 14/14 PASS |
| Database functions as `moin_app` | `node --env-file=.env.example ./node_modules/vitest/vitest.mjs run --project integration packages/db/src/identity-store.integration.test.ts` (own database from the template) | 31/31 |
| HTTP sign-in, fake provider on loopback | same, `apps/server/src/modules/identity-access/sign-in.integration.test.ts` (own database) | 31/31 |
| Real `moin-web` code flow | same, `sign-in-keycloak.integration.test.ts`, Keycloak container recreated from this realm file before the run | 1/1: both fixture users refused (403) before a user row exists, then signed in through Keycloak's login form with S256, session cookie issued, sealed ID token has `aud`=`azp`=`moin-web`, replay refused (400) |
| Unit | `pnpm test` | 578/578 |
| Integration | `pnpm test:integration` | 244/244 |
| Stress | `gates.py stress` on the affected unit suites, 20×; affected integration files looped 20× | 20/20 and 20/20 (62 tests per run) |
| Mutation | `node --env-file=.env.example scripts/mutation-sweep.ts --manifest docs/verification/session-mutation-manifest.json --report docs/verification/session-mutation-report.md` at `8fed525` | exit 0, 21/21 `KILLED_ASSERTION` |
| Boot refusal | built `dist/main-api.js` with `NODE_ENV=staging` and Cognito settings | exit 1, one redacted configuration line naming the KMS dependency, no secret, no stack |

Negative cases asserted to fail closed with no session row: missing, unknown, expired, replayed and
foreign-browser state; concurrent duplicate callbacks (one session; lock wait proven on two
connections); missing code; provider error (state burnt); `iss` mismatch; repeated parameters;
failed and malformed token endpoint; oversized response; foreign signing key; `alg=none` and HS256;
wrong issuer, audience, `azp`, nonce; expired and not-yet-valid tokens; malformed tokens;
unverified email; unknown and disabled user; external, encoded, backslash and normalised return
paths; partial and deployed-environment configuration. Tenant and role claims are ignored.

## QG-09 review

`security-reviewer`, `architecture-reviewer` and `invariant-reviewer` ran on the pre-squash
candidate (`e1d787c..2337082`). No CRITICAL or HIGH finding was reported. Dispositions:

| Finding | Disposition |
| --- | --- |
| Invariant I1: any `moin_app` holder may pass its own `p_now` | Fixed: `app.session_clock` bounds it to 5 min of `clock_timestamp()` (variant B1) |
| Invariant I1: voice/worker hold `moin_app` and could call `begin_session` | **Open founder decision** — a dedicated identity role changes the ADR-0003 role table; see `docs/security/sessions.md` |
| Arch M4: sealed tokens kept after revocation and copied on rotation | Fixed (variant W1) |
| Sec L1 / Invariant C3: dot segments normalise into the sign-in routes | Fixed (variant O2) |
| Sec L2: normalisation exceeds the stored length | Fixed, tested |
| Sec L3: provider body buffered before the size check | Fixed, tested |
| Arch M1: refusal raised in DI bypasses the redacting logger | Fixed at boot; moving it into the loader would break the verified P06.05.04 matrix |
| Arch M3 pool limits, M5 bounded cleanup, L1 one clock read, L2 successor timestamps, L3 race tests | Fixed |
| Arch M2 async sealer/provider interfaces | Deferred to P05.08.01, where the KMS cipher makes sealing async |
| Arch L4 rename `cognito_sub` | Not changed: Data Architecture names it |
| Arch L5, L6; Invariant C1, C2 | Recorded in `docs/security/sessions.md`; P16 retention must delete by family before users |

The squash into `8fed525` folds the remediation into the implementation commit; the tree differs
from the reviewed-plus-remediated tree only by renaming `app.begin_auth_transaction` and
`app.consume_auth_transaction` to `app.begin_sign_in` and `app.consume_sign_in` (bodies and digests
unchanged), done because gitleaks' generic-api-key rule matched the pinned digests beside an `auth`
name. The scanner configuration was not changed.

## Not evidence of

- Cognito: nothing ran against a Cognito pool (P06.05.01, P06.05.05).
- Production token custody: deployed environments refuse sign-in until the KMS data key exists
  (P05.08.01, ADR-0033). The local HKDF-derived key protects local data only.
- Per-request session or membership enforcement, CSRF, step-up and revocation callers
  (P06.06.03–.07).
