# ADR-0005 — Identity, sessions and RBAC

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0003, ADR-0045, INV-02, INV-10, QG-09

## Context

The people who sign in are a restaurant owner and their staff, and an iQuantum operator doing
support. Their sessions must be revocable **immediately** — a departing employee, a stolen laptop,
a support grant that has expired — and every action must be attributable.

Owning password storage, MFA, recovery and credential-stuffing defence is a large amount of
security-critical work that is not this product.

## Decision

**Authentication is Amazon Cognito. Authorization is ours.**

Cognito handles credentials, MFA (TOTP and passkeys), password recovery, lockout and the abuse
signals that come with running an identity provider at scale. It is the identity of a _person_.

**Memberships, roles and permissions live in our database**, because they are tenant-scoped
business data: who belongs to which organisation, in which role, is a row a customer can change,
audit and be billed for. Putting it in the identity provider would make it invisible to RLS,
unauditable in our audit trail, and awkward to query alongside everything it relates to.

**Sessions are server-side rows in PostgreSQL**, not self-contained JWTs. A JWT is valid until it
expires, and "immediately revocable" is the requirement. A session row can be deleted, and the next
request fails. The cost is a lookup per request, which is one indexed primary-key read.

**Step-up authentication** for the operations that deserve it: changing escalation contacts,
granting support access, billing changes, exporting data. Re-authentication is bound to the
session and time-boxed.

**Operator identity is separate from customer identity.** An iQuantum operator has their own
account and sees tenant data only through a customer-granted, time-boxed support grant, recorded in
the audit trail (ADR-0037).

## Alternatives considered

| Option                          | Why not                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Roll our own authentication** | Password hashing, MFA enrolment and recovery, credential-stuffing defence, breach-password checks. Months of security-critical work with a high cost of being subtly wrong, for no product differentiation.                                  |
| **Auth0 / Clerk / WorkOS**      | Capable, and they want to own memberships and roles too, which puts tenant-scoped business data outside our database and outside RLS. Cognito is also already in the AWS account the rest of the system lives in.                            |
| **Keycloak in production**      | Operating an identity provider — patching, availability, backups — is exactly the work Cognito removes. It stays as the **local** provider (ADR-0045), where its value is being an independent implementation that says no on its own terms. |
| **Stateless JWT sessions**      | Cannot be revoked before expiry. Short expiry plus refresh tokens reintroduces server-side state anyway, with more moving parts and a worse failure mode.                                                                                    |
| **Roles in Cognito groups**     | Invisible to RLS, absent from our audit trail, and a second place to look when answering "who could see this".                                                                                                                               |

## Consequences

- Cognito is a hard dependency of sign-in. Its outage is our outage; the SLO and the fallback
  posture are recorded in P15.
- A session lookup per request. One indexed read, and the price of revocation that works.
- Two identity concepts (Cognito subject, our user row) must stay linked. The link is created once
  at first sign-in and is a candidate for drift; it is asserted in P06.
- Local development uses Keycloak, so the two must stay behaviourally aligned. The contract suite
  runs the same assertions against both, and Cognito-specific behaviour is verified against Cognito
  rather than claimed from a local pass (ADR-0045).
- **This is the wrong call if** a customer requires their own identity provider (SSO/SAML). That is
  a per-tenant federation on top of Cognito, not a change to this design.

## Verification

| Enforcement                                         | Where                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| Session revocation takes effect on the next request | P06.06 tests: delete the row, assert 401                                 |
| Tenant context derived server-side only             | P06.03; no route reads an organisation id from the request body (INV-02) |
| MFA required                                        | Cognito pool policy, asserted by the P06 authentication tests            |
| Step-up required for sensitive operations           | Route-level test matrix (P06.08)                                         |
| Every membership and role change is audited         | Append-only audit trail (ADR-0017, INV-10)                               |
| Operator access only through a time-boxed grant     | P15.04 support-access tests; grants expire and are audited               |
