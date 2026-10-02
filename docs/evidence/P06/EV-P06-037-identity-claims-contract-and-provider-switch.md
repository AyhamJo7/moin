# EV-P06-037: Provider-neutral identity-claims contract (subject, verified lower-cased email) proven against a real local Keycloak token and the documented Cognito shape; one OIDC provider per environment; 12/12 mutation variants KILLED_ASSERTION

| Field | Value |
|---|---|
| Evidence ID | EV-P06-037 |
| Item | P06.05.04 |
| Date (UTC) | 2026-10-02 02:04 UTC |
| Commit | `215e878bcc2f032dcddd578791122372bec1291a` |
| Environment | local |
| Command / procedure | `.claude/bin/gates.py full`: `python3 .claude/bin/control_plane_check.py && python3 -m unittest discover -s .claude/tests -t .claude/tests` → pass (exit 0, 22.4 s); `uvx ruff@0.15.12 format --check --config .claude/ruff.toml .claude && uvx ruff@0.15.12 check --config .claude/ruff.toml .claude && uvx --from mypy==2.3.1 mypy --config-file .claude/mypy.ini` → pass (exit 0, 0.4 s); `node scripts/check-conventional-commit.ts --self-test && node scripts/check-no-ai-mentions.ts --self-test` → pass (exit 0, 0.1 s); `node scripts/check-adr-coverage.ts && node scripts/check-domain-coverage.ts && node scripts/check-dfd-coverage.ts && node scripts/check-threat-model-refs.ts && node scripts/check-data-classification.ts && node scripts/check-subprocessors.ts && node scripts/check-brand-strings.ts` → pass (exit 0, 1.5 s); `pnpm exec prettier --check .` → pass (exit 0, 3.1 s); `pnpm lint` → pass (exit 0, 9.1 s); `pnpm exec depcruise apps packages scripts --config .dependency-cruiser.cjs` → pass (exit 0, 0.8 s); `pnpm typecheck` → pass (exit 0, 4.3 s); `pnpm test` → pass (exit 0, 5.5 s); `pnpm test:integration` → pass (exit 0, 10.1 s); `node scripts/check-migrations.ts` → pass (exit 0, 0.1 s); `pnpm turbo run build` → pass (exit 0, 6.2 s); `node scripts/check-licences.ts` → pass (exit 0, 0.4 s); `gitleaks git --redact --no-banner --config .gitleaks.toml .` → pass (exit 0, 0.5 s) |
| Result | PASS |
| CI run / artifact | pending |
| Reviewer | pending |

Sensitive material is stored by reference only (PLAN.md evidence rules).

## Scope

P06.05.04, engineering portion: "Local-development OIDC provider with the same claims shape;
configuration switch per environment". Base `14fe443` (PR #32). Nothing from P06.06.01 is built: no
callback, code exchange, PKCE verifier, `state`/nonce validation, sessions, cookies or token storage.

## Findings that changed the realm

Measured against the running local Keycloak (26.7.4, digest-pinned) through its admin API before
any change: `moin-web` default client scopes were `profile, roles, email` (the committed `"openid"`
entry names no Keycloak scope and was dropped on import), so `basic`, which carries `sub` since
Keycloak 25, was missing; `moin-tests` used the realm defaults, a different set. A fixture token
therefore did not stand for a browser-client token, and the browser client's ID tokens had no
subject (inferred from the scope assignment; a `moin-web` token cannot be obtained without the
browser code flow, which stays out of scope). Both clients now map exactly `basic` and `email` with
no optional scopes, and the realm defines no roles (ADR-0005: roles are memberships in our
database). ADR-0045's "roles as claims" line contradicted ADR-0005 and is amended.

## Contract

| Canonical | Source requirement | Keycloak | Cognito (documented shape) |
| --- | --- | --- | --- |
| `subject` | `users.cognito_sub` UNIQUE (PLAN Data Architecture), ADR-0005 link | `sub` | `sub` |
| `email` (lower-cased) | `users.email` citext; P06.08.02 verified email | `email` | `email` |
| gate: must be `true` | P06.08.02 | `email_verified` | `email_verified` |

All other claims are ignored, including organisation, location, role, permission,
`realm_access`, `cognito:groups`, `custom:*`, `preferred_username` and `cognito:username`.

## Results

| Check | Command | Result |
| --- | --- | --- |
| Focused unit tests | `pnpm exec vitest run --project unit apps/server/src/config apps/server/src/modules/identity-access` | 88/88 pass (`identity-claims` 28, `oidc` 33, `oidc-realm` 7, `env` 20) |
| Live local token | `TEST_OIDC_ISSUER_URL=http://127.0.0.1:8080/realms/moin-local pnpm test:integration apps/server/src/config` | 1/1 pass: real password grant through `moin-tests` for both fixture users, RS256 signature verified against the realm JWKS, `iss`/`aud`/`exp` checked, ID token parsed, equal to the Cognito-shaped identity, no claim outside the contract, no role claim in the access token |
| Same test, old realm | as above, against the realm at `14fe443` | 2/2 failed on `name`, `preferred_username`, `given_name`, `family_name` outside the contract (the test detects the drift) |
| Provider matrix | `oidc.test.ts` | accepted exactly `development:keycloak`, `test:keycloak`, `staging:cognito`, `production:cognito` |
| Mutation sweep | `node --env-file=.env.example scripts/mutation-sweep.ts --manifest docs/verification/identity-mutation-manifest.json --report docs/verification/identity-mutation-report.md` at `5544925` | exit 0, 12/12 `KILLED_ASSERTION` |
| Full suites at `215e878` | `pnpm test`, `pnpm test:integration` | 521 and 182 pass |
| Gates | `python3 .claude/bin/gates.py full` at `215e878`, 0 changed files | 14/14 PASS |

## Not evidence of

- Cognito's real token shape or its `email_verified` type: the Cognito side is the documented
  shape as a fixture. P06.05.01 (pool) and P06.05.05 (staging verification) remain open.
- `moin-web` tokens directly: shape parity with `moin-tests` is asserted statically.
