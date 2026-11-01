# ADR-0046 — Invitation acceptance entry path

- **Status:** Accepted (default adopted under founder delegation 2026-11-01; founder may override)
- **Deciders:** founder (delegated to the orchestrating session on 2026-11-01)
- **Phase:** P06.08 (design), implemented by a later task
- **Related:** ADR-0005, INV-02, INV-10, P06.08.02

## Context

`app.accept_invitation` and the store-layer `acceptInvitation` are built and tested: they consume a
token, bind an identity to a membership and write an audit event. They have no HTTP route. An invitee
has no `users` row, and sign-in refuses an unknown subject by design (migration 0012), so there is no
session to authenticate an accept call with. The organisation is also unknown until the token is read
(INV-02). The entry path was recorded as an open founder decision; this ADR adopts a default so the
work can continue, and the founder may override it.

## Decision

1. **Link.** The invitation e-mail carries a link with the invitation id and the one-time token.
2. **Sign-in or sign-up through the hosted identity provider.** The link sends the invitee to the
   Cognito hosted sign-in and sign-up page (Keycloak in local development and tests, per ADR-0045),
   not to a page of ours that handles credentials.
3. **Callback.** The existing callback completes the sign-in. For an invitee it creates no session by
   itself and no membership: it carries the verified identity claims forward to the accept step.
4. **Accept.** A POST accept route takes the invitation token. It requires a **verified e-mail** claim
   whose value, case-normalised, equals the invitation's e-mail; otherwise it refuses without saying
   which part failed.
5. **Binding.** The accept binds the identity-provider subject to the membership through
   `app.accept_invitation`, which already serialises per invitation, checks revocation and expiry at
   lock time, and refuses to resurrect a non-active user or membership.
6. **Single use.** The token is consumed by a successful accept; presenting it again returns the
   existing outcome for the same subject and an indistinguishable refusal for anyone else.
7. **Audit.** The accept writes one audit event (INV-10) with opaque markers only (INV-12).
8. **Tenant.** The organisation is derived from the invitation row after the token digest matches,
   never from a request field (INV-02).

### Order of implementation

The route is a later task. It must follow the invite role ceiling fix (an admin may not issue an
invitation that confers `billing_admin` or `integration_admin`), because accepting an invitation is
the first path by which such a permission becomes real.

## Alternatives considered

| Option                                                                      | Why not                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pre-create a `users` row for the invitee and let the normal sign-in find it | Turns an unauthenticated e-mail address into an account before the person proves control of it, and loosens the rule that sign-in refuses an unknown subject |
| Accept on the invitation token alone, without a verified e-mail match       | The link would be a bearer credential: anyone who obtains it becomes a member                                                                                |
| Our own sign-up page that collects a password                               | We would hold credentials, which the identity provider exists to avoid, and a second authentication surface to defend                                        |
| Open sign-up, then the owner assigns the person manually                    | No binding between the invitation and the identity; the audit trail would show a person added, not an invitation consumed                                    |

## Consequences

- The invitee needs an e-mail address that the identity provider can verify; an invitation to an
  address the person cannot verify cannot be accepted, which is the intended failure.
- A mismatch between the invited address and the signed-in address is a refusal, so an owner who
  invites the wrong address must re-invite.
- The sign-in callback gains a state in which a verified identity exists without a session. That
  state must be tested as carefully as the session paths.
- This would be the wrong call if invitees could not use the hosted pages, or if the verified-e-mail
  claim cannot be relied on from the chosen provider configuration; the Cognito setup (P05) must
  confirm the claim before the route ships.

## Verification

| Enforcement                                                                                                                                                                                 | Where                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The store function refuses an e-mail mismatch, an expired, revoked or consumed invitation, and a non-active user or membership                                                              | `apps/server/src/modules/identity-access/members.integration.test.ts` (invitations) |
| The accept route, when built, must pass a real-HTTP test for each refusal above, for token replay and for an unverified e-mail; and appear in the route inventory of the cross-tenant suite | the implementing task (P06.08.02)                                                   |
