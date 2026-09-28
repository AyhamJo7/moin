# ADR-0045 — Local OIDC provider: Keycloak

- **Status:** Accepted (P02.04.01, 2026-09-28) · **Deciders:** founder
- **Scope:** local development and automated tests only
- **Related:** ADR-0002, INV-02, P06 (identity and access)

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
- Issuer validation, audience/client validation, and a confidential client with a secret.
- JWKS discovery at the standard `.well-known` endpoint, and key rotation.
- Access-token and ID-token validation, expiry (`accessTokenLifespan` 300 s), refresh-token
  rotation with reuse revoked.
- Roles as claims (`owner`, `staff`, `operator`) — only the shape our authorization contract reads.
- Negative cases, which are the point: invalid issuer, invalid audience, expired token, unknown
  signing key, malformed token.

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

| Enforcement                                                 | Where                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The provider is pinned by digest and its realm is committed | `docker-compose.yml` + `docker/keycloak/realm-moin-local.json`, imported on boot                                    |
| PKCE is required, matching production                       | Realm attribute `pkce.code.challenge.method: S256`; a code without a verifier is rejected                           |
| The negative cases are exercised                            | P06 auth suite: invalid issuer, invalid audience, expired token, unknown signing key, malformed token               |
| No Keycloak-specific concept reaches production code        | The auth boundary depends on standard OIDC only; no admin-API call and no Keycloak claim outside the local fixtures |
| Cognito-specific behaviour is verified against Cognito      | P06 records each such item as a staging verification; a local pass is a precondition, not evidence                  |
