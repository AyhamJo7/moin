# Sign-in and server-side sessions

- **Implements:** P06.06.01, P06.06.02 · **Decision:** ADR-0005 · **Review:** QG-09
- **Code:** `apps/server/src/modules/identity-access/`, `packages/db/src/identity-store.ts`,
  `packages/db/migrations/0012_identity_and_sessions.sql`

Authentication is the identity provider's; authorisation is ours (ADR-0005). This document
describes the part in between: how a person who has authenticated at the provider ends up holding
a KlarDesk session, what that session is, and what it is not.

## What a session is — and is not

A session identifies **a person who has an active `users` row**. It does not identify an
organisation, a location, a role or a permission, and nothing in it came from a token claim except
the provider subject, which the reviewed identity-claims parser (P06.05.04) has already reduced to
`sub` plus a verified email.

- Sign-in **never creates a user**. A subject with no active `users` row is refused (403) after it
  has authenticated. Rows are created by invitation acceptance (P06.08.02).
- Tenant, organisation, role and permission claims — `organisation_id`, `tenant_id`, `role(s)`,
  `permissions`, `realm_access`, `resource_access`, `cognito:groups`, `custom:*` — are ignored.
  There is no column they could reach.
- Which organisation a request acts for, and whether the person is still a member there, is decided
  per request from our own tables. **That check is P06.06.03 and does not exist yet.** Until it
  does, no route grants tenant access on the strength of a session.

## Sign-in: Authorization Code + PKCE, server-side

```text
browser ──GET /api/auth/login?returnTo=/today──► api
   api: state, nonce, verifier, binding ← 4 × 256-bit CSPRNG
        auth_transactions ← sha256(state), sha256(binding), sha256(nonce),
                            seal(verifier), returnTo, expires = now + 10 min
   ◄── 302 provider/authorize?response_type=code&state&nonce&code_challenge=S256(verifier)
       Set-Cookie: __Host-moin_signin=<binding>; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax

browser ──(authenticates at the provider, MFA there)──► provider
   ◄── 302 /api/auth/callback?code&state[&iss]

browser ──GET /api/auth/callback──► api
   1. consume_sign_in(sha256(state), sha256(binding)) — DELETE, once
   2. provider error?  missing code?  iss ≠ issuer?           → fail
   3. open(verifier); POST token endpoint (Basic client auth, code, redirect_uri, code_verifier)
   4. verify ID token (jose): RS256 only, iss exact, aud = client, exp/nbf, iat ≤ 10 min,
      azp = client when present or when aud has several entries; sha256(nonce) = stored
   5. parseIdentityClaims → { subject, email } (email_verified must be true)
   6. seal provider tokens; begin_session(subject, sha256(new token), …, presented session)
   ◄── 302 /today
       Set-Cookie: __Host-moin_sid=<token>; Max-Age=<s to absolute expiry>; Path=/; HttpOnly; Secure; SameSite=Lax
       Set-Cookie: __Host-moin_signin=; Max-Age=0; …
```

### Who owns which value

| Value              | Generated     | Browser sees                        | Stored                               | Checked                                                    |
| ------------------ | ------------- | ----------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `state`            | api, 256 bit  | in the provider URL and callback    | SHA-256 only                         | consumed by digest, exactly once                           |
| browser binding    | api, 256 bit  | `__Host-moin_signin` cookie         | SHA-256 only                         | must match the transaction — login CSRF defence (RFC 9700) |
| nonce              | api, 256 bit  | in the provider URL                 | SHA-256 only                         | constant-time against the ID token's `nonce`               |
| PKCE verifier      | api, 256 bit  | **never** (only the S256 challenge) | AES-256-GCM sealed, bound to state   | sent once to the token endpoint, server-to-server          |
| authorization code | provider      | in the callback URL, once           | never                                | redeemed by api; the callback answers `no-referrer`        |
| provider tokens    | provider      | **never**                           | AES-256-GCM sealed in `sessions`     | ID token verified before anything is stored                |
| session token      | api, 256 bit  | `__Host-moin_sid` cookie only       | SHA-256 only (`sessions.token_hash`) | every lookup is by digest                                  |
| OIDC redirect URI  | configuration | —                                   | —                                    | must name `/api/auth/callback`, or sign-in refuses to boot |
| return path        | caller        | —                                   | the validated path, server-side      | internal path only (`domain/return-path.ts`)               |

### Single use under concurrency

`consume_sign_in` deletes the row on **any** presentation of its `state` — from the right
browser, a wrong one, or one with no binding at all — and only then compares the binding and the
expiry. A replay finds nothing; a probe burns what it probes; two concurrent callbacks serialise on
the row lock and the second deletes nothing. If the exchange fails after that, the person starts a
fresh sign-in: there is deliberately no retry window.

### No caller-chosen URL

Discovery is `<configured issuer>/.well-known/openid-configuration`; its `issuer` must equal the
configured one exactly; the JWKS must be on the issuer's origin; every endpoint must be HTTPS
(loopback for the local provider); redirects are never followed; requests time out after 10 s.
Provider error bodies are discarded unread. Failures carry a stable reason code, logged through the
redacting logger, and the browser receives one of four RFC 9457 problems:

| Problem                                  | Status | Covers                                                                     |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `/problems/sign-in-failed`               | 400    | bad/replayed/expired/foreign callback, provider error, any token rejection |
| `/problems/sign-in-not-permitted`        | 403    | authenticated, but no active user here                                     |
| `/problems/sign-in-provider-unavailable` | 502    | discovery, keys or token endpoint unreachable or failing                   |
| `/problems/sign-in-unavailable`          | 503    | no OIDC client configured in this deployment                               |

## Provider-token custody

Provider tokens and PKCE verifiers are sealed with AES-256-GCM (`infrastructure/token-cipher.ts`):
a fresh 96-bit IV per seal, a key id stored beside the ciphertext, and associated data that binds
each value to what it belongs to — `moin/provider-tokens/v1:<session family>`,
`moin/pkce-verifier/v1:<sha256(state)>` — so a ciphertext copied into another row does not open.
The key is never in the database.

**Where the key comes from is not finished.** Deployed environments must use a KMS data key
(ADR-0033, P05.08.01); ADR-0020 records why a key in the environment is not acceptable there.
That source does not exist yet, so:

- `staging` and `production` **refuse to start sign-in** (`resolveTokenCipher` throws a
  `ConfigurationError` at boot), whatever variables are present;
- `AUTH_LOCAL_TOKEN_KEY` is refused by the configuration loader outside `development` and `test`;
- development and test derive a key from it with HKDF-SHA256. That key protects local data and
  nothing else.

Production token custody is therefore **not verified** and cannot be until P05.08.01 provides the
KMS key and the cipher is given a KMS-backed keyring.

## The session

`sessions` is a global table (no tenant column; see `docs/architecture/global-tables.md`) keyed by
`token_hash` = SHA-256 of the cookie value. No runtime role has a privilege on it, on `users`, or on
`auth_transactions`. Six `SECURITY DEFINER` functions are the only way
in (`docs/architecture/security-definer-allowlist.md`, pinned by body digest in
`scripts/check-rls-catalog.ts`), and they are executable by **`moin_identity` alone**.

### Who may reach a session (ADR-0003 amendment, QG-09 finding I1)

| Role                                                                       | Process                                            | Session functions     | Session tables | Tenant tables        |
| -------------------------------------------------------------------------- | -------------------------------------------------- | --------------------- | -------------- | -------------------- |
| `moin_identity`                                                            | `api` only (`IDENTITY_DATABASE_URL`, its own pool) | the six, nothing else | none           | none                 |
| `moin_app`                                                                 | `api`, `voice`, `worker`                           | **none**              | none           | under RLS, as before |
| `moin_dispatcher`, `moin_provisioner`, `moin_support_ro`, `moin_reporting` | as before                                          | none                  | none           | as before            |

`moin_identity` is `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, is a member
of no role, and owns nothing. Migration 0012 rejects members except a trusted provisioning role
with `CREATEROLE`, an `ADMIN`-only grant (neither `INHERIT` nor `SET`), no `moin_` prefix, and no
membership path from a runtime role. PostgreSQL 16+ records this grant when a non-superuser creates
a role, including an RDS master user. **ADMIN can self-grant SET or INHERIT**: this exception trusts
the provisioning administrator; it does not claim that ADMIN prevents impersonation. It can create nothing: no `CREATE` on any schema, and
`TEMPORARY` is moved off `PUBLIC` wherever roles are provisioned. The catalog check asserts the whole
ACL on every run (`identity-role-*`: attributes, membership, ownership of tables, functions, types,
schemas, databases and large objects, table, column and `MAINTAIN` privileges in every schema,
grant options, temporary objects, exactly the six definers), and separately that no other runtime
role can execute the six by any route or hold any privilege on the session tables
(`session-function-reachable`, `session-table-privilege`). `IDENTITY_DATABASE_URL` must name `moin_identity`, and `/readyz`
fails unless the pool really connects as it and `moin_app` really cannot execute the functions. The configuration loader refuses
`IDENTITY_DATABASE_URL` for `voice`, `worker` and `migrate`, `identity-is-api-only` keeps the
identity module and pool out of their module graphs, and an api with OIDC but no identity pool
refuses to start. So a compromised voice or worker process — which holds `moin_app` — cannot mint,
resolve, rotate or revoke a session.

### Lifetime (T-15)

| Rule                                      | Enforced by                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| idle timeout 12 h after the last activity | `resolve_session` validity predicate; CHECK `idle_expires_at <= last_seen_at + 12 h`                         |
| absolute timeout 7 days after sign-in     | `begin_session` sets it; CHECK `absolute_expires_at <= created_at + 7 d`; trigger forbids changing it        |
| idle expiry never passes absolute expiry  | `LEAST(now + 12 h, absolute)`; CHECK `idle_expires_at <= absolute_expires_at`                                |
| a revoked session never revives           | no function clears `revoked_at`; trigger rejects it, even for the table owner                                |
| an expired session never revives          | validity is `idle > clock_timestamp() AND absolute > clock_timestamp()`; rotation requires valid predecessor |
| authoritative database clock only         | `clock_timestamp()` evaluated in PostgreSQL; caller-supplied time is never accepted for authorization        |

Activity is written at most once a minute: a touch that would move the idle expiry by less than
60 s is skipped. That only ever leaves the stored idle expiry **earlier** than ideal, never later,
so the 12-hour bound holds exactly. Time is PostgreSQL's own `clock_timestamp()`, so callers
holding `moin_identity` cannot backdate or forward-date any authorization decision. An expired or
revoked session cannot be resolved, rotated, or revived. On rotation, family and predecessor locks are
acquired first, a fresh `clock_timestamp()` is obtained, and validity is rechecked post-lock before any
mutation occurs.

### Rotation

| Trigger          | Path                                                                                                                            | Absolute expiry        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| login            | `begin_session`: always a new random token; the session the browser presented is revoked (`superseded`) in the same transaction | new: now + 7 d         |
| step-up          | `rotate_session(…, 'step_up')`                                                                                                  | inherited, never moved |
| privilege change | `rotate_session(…, 'privilege_change')`                                                                                         | inherited, never moved |

`rotate_session` locks and revokes the predecessor and inserts the successor in one statement; the
sealed provider tokens move to the successor and are wiped from the predecessor. A racing second
rotation re-reads `revoked_at` after the row lock and inserts nothing, and `rotated_from` is UNIQUE
as the structural backstop. `family_id` carries through rotations for forensic lineage.

**Only the login caller exists.** `SessionService.rotate` is the primitive P06.06.04 (step-up) and
P06.07 (privilege change) will call after their own checks; the step-up endpoint (P06.06.04) is now
its first caller, and the privilege-change caller is still unclaimed.

### Fixation

The post-login token is generated by the server, never taken from the request. A cookie the browser
presents at callback is only ever hashed: if it is a session, that session is revoked; if it is
anything else — an attacker-planted value — it matches nothing and changes nothing.

Revocation — sign-out, supersession at login, rotation — sets the sealed provider tokens to NULL:
a refresh token never outlives the session it belongs to. The guard trigger allows exactly that
change and no other to those columns.

## Boot behaviour

Sign-in is built when the API starts. A deployment that configures OIDC but cannot seal provider
tokens (every deployed environment until P05.08.01) fails to start: `bootstrap.ts` gives Nest the
redacting logger and `abortOnError: false`, catches the `ConfigurationError`, writes one line that
names the problem and no value, and exits 1. The configuration loader still accepts a Cognito
configuration in staging and production, as the founder-verified P06.05.04 contract requires; the
refusal is the token-custody check's, not the provider switch's.

## Residual risks for review

- **The database trusts the application for authentication proof.** `begin_session` cannot verify
  an ID token; it bounds what a caller can _shape_ (lifetimes, single use, revocation), not _who_ it
  may sign in. That is inherent to verifying tokens in the application.
- **Signing out other devices** (`POST /api/auth/sign-out-others`) ends every other live session
  of the caller's own account with reason `sign_out_others` and keeps the presenting one; a dead
  cookie ends nothing. Password/MFA resets end every session (`password_reset`, `mfa_reset`).
  A role or permission change (`role_change`), a removal (`membership_removed`), a status change
  (`membership_status`) and an organisation termination's membership cascade all revoke through an
  AFTER trigger on `memberships`, regardless of which code path edited it. Unrelated membership
  writes revoke nothing. The per-request lookup locks the membership first, so a change racing a
  request serialises instead of deadlocking.
- **Two tabs finishing sign-in at once** both supersede the old session and each issue a new one;
  the browser keeps the last cookie and the other session lives on until it expires. A sign-in and a
  rotation of the session it supersedes both lock the family root before changing the family. This
  also serializes a stale cookie against rotation of its current successor; sign-in supersedes the
  whole family. Listing and ending sessions is P06.06.05.
- **A failed sign-in leaves the browser's existing session alone.** If person B's sign-in fails on a
  shared device where A is signed in, A stays signed in; supersession happens only when a new
  session is issued. A failed attempt is not a sign-out.
- **`NODE_ENV` defaults to `development`.** A deployment that forgot to set it would accept
  `AUTH_LOCAL_TOKEN_KEY`; the provider switch still confines that configuration to Keycloak on a
  loopback issuer, so it cannot sign anyone in through Cognito. The image sets
  `NODE_ENV=production`.
- **Pending sign-ins are unauthenticated writes.** Each `GET /api/auth/login` writes one row that
  lives at most 10 minutes. Flood resistance is the WAF rate rule (Security Architecture), which is
  P05 infrastructure.
- **Discovery is cached per process.** A provider that moves its endpoints needs a restart; keys
  are refetched by `jose` on an unknown `kid`.

## Still open

| Item          | What is missing                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P06.06.03     | per-request session + membership re-check; `active_organisation_id`; the 30 s read-only cache                                                                 |
| P06.06.04     | step-up MFA policy, `step_up_at` + `step_up_fresh`, the step-up guard, and the step-up endpoint calling `rotate_session('step_up')` (shipped; pending review) |
| P06.06.05     | revocation on password/MFA reset, role change, membership removal, "sign out other devices" (shipped; pending review)                                            |
| P06.06.06     | CSRF synchronizer token and Origin check (the sign-in routes are GETs and change no tenant state)                                                             |
| P06.06.07     | the complete lifecycle acceptance suite, including FS-16                                                                                                      |
| P06.05.05     | the same flow against the staging Cognito pool; nothing here is verified against Cognito                                                                      |
| P05.08.01     | the KMS data key for provider-token custody; until then deployed sign-in refuses to start                                                                     |
| P06.08.02     | creation of `users` rows (invitation acceptance)                                                                                                              |
| P05.08.02/.03 | Secrets Manager entry for `moin_identity`, injected into the `api` task definition only; the Terraform role                                                   |
