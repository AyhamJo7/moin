# ADR-0045 — Local OIDC provider: Keycloak

- **Status:** Accepted (P02.04.01, 2026-09-28) · **Deciders:** founder
- **Scope:** local development and automated tests only
- **Related:** ADR-0002, ADR-0005, INV-02, P06 (identity and access)
- **Amended:** P06.05.04 (2026-10-02): identity-claims contract and per-environment provider switch

## Context

PLAN.md requires "a local OIDC provider for auth flows" without naming one, while production
identity is **Amazon Cognito**. The gap between them is where authentication bugs live: a stub that
always returns a valid user makes every auth test pass and proves nothing, because the properties
that actually break — issuer and audience validation, JWKS rotation, expiry, PKCE — are exactly the
ones a stub does not have.

## Decision

**Keycloak**, pinned by digest, as a local and test OIDC provider only.

```text
quay.io/keycloak/keycloak@sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c   (26.7.4)
```

Production and staging identity remain **Amazon Cognito**. The application depends on standard
OIDC concepts and on our own auth boundary, never on Keycloak APIs: no admin-API calls, no
Keycloak-specific claims, no realm assumptions in domain or application code. The realm is
committed as data (`docker/keycloak/realm-moin-local.json`) and imported on boot, so the local
provider is reproducible rather than hand-configured.

### Properties the local realm reproduces

Chosen because our auth boundary genuinely depends on each:

- Authorization-code flow with **PKCE required** (`S256`), matching the production client. A local
  provider that accepted a code without a verifier would let a broken client pass every local test.
- The browser client disables direct password grants and the implicit flow. The separate test
  client may use direct grants to create local fixtures; application sign-in never uses it.
- Issuer validation, audience/client validation, and a confidential client with a secret.
- JWKS discovery at the standard `.well-known` endpoint, and key rotation.
- Access-token and ID-token validation, expiry (`accessTokenLifespan` 300 s), refresh-token
  rotation with reuse revoked.
- The identity-claims contract below, and nothing else. The realm defines no roles or groups and
  emits no role claims: roles and permissions are rows in our database (ADR-0005), so a local
  token that carried them would invite code that reads them.
- Negative cases, which are the point: invalid issuer, invalid audience, expired token, unknown
  signing key, malformed token.

### Identity-claims contract (P06.05.04)

An ID token tells us who a person is, never what they may do. Both providers normalise to one
`VerifiedIdentity` (`apps/server/src/modules/identity-access/domain/identity-claims.ts`), so code
after the sign-in callback cannot tell them apart:

| Canonical field | Source requirement                                            | Keycloak (local)                        | Cognito (staging, production) | Required         | Meaning                                                    |
| --------------- | ------------------------------------------------------------- | --------------------------------------- | ----------------------------- | ---------------- | ---------------------------------------------------------- |
| `subject`       | `users.cognito_sub` UNIQUE (Data Architecture); ADR-0005 link | `sub` (client scope `basic`)            | `sub`                         | yes              | Stable link to our user row; never the email               |
| `email`         | `users.email` citext; P06.08.02 binds by verified email       | `email` (client scope `email`)          | `email`                       | yes, lower-cased | Address invitations are matched against                    |
| (gate only)     | P06.08.02 "verified email"                                    | `email_verified` (client scope `email`) | `email_verified`              | must be `true`   | An unverified identity is refused, not carried with a flag |

- Wrong types, arrays or objects where a string is expected, a malformed or overlong email and a
  missing claim all fail closed. Errors name the claim, never its value.
- Every other claim is ignored. `organisation_id`, `tenant_id`, `location_id`, roles,
  `permissions`, `realm_access`, `cognito:groups`, `custom:*`, `preferred_username` and
  `cognito:username` never become identity attributes or aliases: tenancy and authorization are
  resolved server-side from memberships (INV-02, BR-109).
- Both providers are asked for the same scopes, `openid email` (`OIDC_SCOPES`). Both local clients
  map exactly the `basic` and `email` client scopes: Keycloak 25 moved `sub` into `basic`, so a
  client that lists its scopes without it issues ID tokens with no subject.
- The Cognito column is the documented Cognito ID-token shape, exercised as a fixture. It is not
  evidence about Cognito; P06.05.05 verifies it in staging.

### Provider per environment (P06.05.04)

| `NODE_ENV`              | Provider   | Issuer accepted                                                      |
| ----------------------- | ---------- | -------------------------------------------------------------------- |
| `development`, `test`   | `keycloak` | loopback only                                                        |
| `staging`, `production` | `cognito`  | `https://cognito-idp.<eu-region>.amazonaws.com/<eu-region>_<poolId>` |

`OIDC_PROVIDER` is declared and must agree with this table; it is never inferred. All five
`OIDC_*` settings are present or none are, and `loadConfig` refuses anything else at boot. There is
no fallback from one provider to the other. `resolveOidcConfig` turns the validated settings into
one provider-neutral `OidcClientConfig` (provider, issuer, client id, redacted client secret,
callback, scopes) and fails closed when sign-in asks for it and none is configured. The client
secret stays server-side: it is printable only through `reveal()`, and `apps/web` cannot import
server configuration.

**Not here.** The authorization-code callback, code exchange, PKCE verifier, `state` and nonce
validation, token signature/issuer/audience checks, sessions and cookies belong to P06.06.01 and
later, which consume `OidcClientConfig` and `parseIdentityClaims` without knowing the provider.

### What Keycloak cannot honestly prove

Cognito-specific behaviour is **verified against Cognito**, never claimed from local evidence:

- Cognito's hosted UI, its token structure and its custom-claim mechanics.
- Its MFA implementation and device tracking.
- Its account recovery and lockout behaviour.
- User-pool triggers (Lambda), group-to-claim mapping, and advanced security features.
- Cognito's own rate limits and error taxonomy.
- Refresh-token lifetimes and revocation semantics as Cognito implements them.

P06 records each of those as a staging verification item; passing locally is a precondition, not
evidence.

### Why not the alternatives

| Option                      | Why not                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cognito itself, locally** | There is no local Cognito. Using a real user pool for development would put an AWS dependency and real credentials on every developer machine (EXT-09), and is the credential-shaped coupling this repository avoids. |
| **`node-oidc-provider`**    | A library, so it would live in our test code — and a provider we configure ourselves tends to be configured to agree with us. Keycloak is an independent implementation that says no on its own terms.                |
| **Dex**                     | Lighter, but built for federating upstream identity providers rather than being one; weaker local user, role and token-lifetime management.                                                                           |
| **A fake/stub issuer**      | Would make every auth test pass while proving nothing about issuer, audience, JWKS or expiry handling — the failure this ADR exists to prevent.                                                                       |

## Consequences

- Auth flows are exercised end to end offline, including the negative cases.
- Two providers must stay behaviourally aligned; the alignment is asserted by the P06 contract
  suite, which runs the same assertions against staging's Cognito.
- Keycloak is the heaviest container in the local stack (~20 s to become ready), which the health
  check and `pnpm doctor` account for.
- Every credential in the committed realm is a development-only literal. Production secrets live in
  AWS Secrets Manager and are referenced by ARN (INV-15).

## Verification

| Enforcement                                                 | Where                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The provider is pinned by digest and its realm is committed | `docker-compose.yml` + `docker/keycloak/realm-moin-local.json`, imported on boot                                                                 |
| PKCE is required, matching production                       | Realm attribute `pkce.code.challenge.method: S256`; `oidc-realm.test.ts` checks the browser client cannot use implicit or direct password grants |
| The negative cases are exercised                            | P06 auth suite: invalid issuer, invalid audience, expired token, unknown signing key, malformed token                                            |
| No Keycloak-specific concept reaches production code        | The auth boundary depends on standard OIDC only; no admin-API call and no Keycloak claim outside the local fixtures                              |
| Both providers normalise to one identity; roles are ignored | `identity-claims.test.ts`; `oidc-realm.test.ts` pins both local clients to the `basic` and `email` scopes and the realm to no roles              |
| A real local token satisfies the contract                   | `oidc-realm.integration.test.ts`: signs in through `moin-tests`, verifies the signature against the realm keys, parses the ID token              |
| One provider per environment, no fallback                   | `oidc.test.ts`: environment × provider matrix, Cognito issuer shape, partial settings, secret redaction and the browser boundary                 |
| Cognito-specific behaviour is verified against Cognito      | P06 records each such item as a staging verification; a local pass is a precondition, not evidence                                               |
