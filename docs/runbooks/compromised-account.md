# Runbook — compromised account (P06.09.03)

- **Status:** procedure defined, **not executable in production**. It becomes executable only when
  every control marked _REQUIRED CONTROL_ below exists and the P06.09.04 tabletop is recorded.
- **Owner:** security / on-call (the founder until P15.10 assigns otherwise)
- **Invariants:** INV-01, INV-02, INV-10, INV-12, INV-15 · **Related:** ADR-0005, ADR-0017,
  ADR-0020, [MFA reset](mfa-reset.md), [audit chain break](audit-chain-break.md),
  `docs/security/threat-model.md` (residual R-4)

Use this when a customer user's or an operator's account may be controlled by someone else.
**Contain first, then investigate, and preserve everything.** Deleting the user or the membership
first hides the trail of what the account did.

A compromised owner account is not "the owner's own data at risk": it exposes the callers' personal
data, for which the customer is controller and we are processor (threat model, residual R-4). Treat
it as a potential Art. 33 GDPR breach from the start.

## What exists today and what does not

| Control                                                                         | State on `main`                                                                                                                                                                                                   | Owner item                         |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Provider-neutral identity `{ subject, email }`; no tenant or role from the IdP  | implemented and verified locally; no sign-in callback consumes it yet                                                                                                                                             | P06.05.04 (EV-P06-037, EV-P06-038) |
| Customer and operator user pools                                                | not provisioned                                                                                                                                                                                                   | P06.05.01, P06.11.01               |
| Server-side sessions; revocation on demand; membership re-check per request     | not built                                                                                                                                                                                                         | P06.06.02, P06.06.03, P06.06.05    |
| Disable or remove a member                                                      | not built                                                                                                                                                                                                         | P06.08.03                          |
| Password reset (email) and MFA reset                                            | not built                                                                                                                                                                                                         | P06.09.01, P06.09.02               |
| Support access grants, operator audit, emergency access                         | not built                                                                                                                                                                                                         | P06.11.02, P06.11.04               |
| Security events (failed logins, MFA changes, new device) and owner notification | not built                                                                                                                                                                                                         | P06.12.02                          |
| Audit trail                                                                     | append-only, hash-chained table, tenant-scoped query API and the chain verifier command exist (P06.10.01, .02, .04); its daily schedule waits on EXT-09 (P06.10.05); **no production code path writes to it yet** | P06.10.03                          |
| Cross-tenant suite                                                              | RLS isolation tests exist (P06.02.06); the route-level suite does not                                                                                                                                             | P06.13                             |
| Integrations holding customer OAuth credentials                                 | none connected; none built                                                                                                                                                                                        | ADR-0020, P20.03.03                |
| Incident severity, templates, breach workflow                                   | not written                                                                                                                                                                                                       | P15.10.01, P15.10.02               |
| Tabletop of this runbook                                                        | not run                                                                                                                                                                                                           | P06.09.04                          |

Until the containment controls exist, the only containment available is at the identity provider,
and that needs a provisioned pool. Record that gap in the incident rather than improvising a manual
database change.

## Signs of compromise

- The user or an owner reports activity they did not do, or a sign-in they do not recognise.
- A notification of an MFA or password change the user did not make (P06.12.02).
- Unknown sessions in the user's session list (P13.08.03).
- Security events: bursts of failed sign-ins, a new device, MFA changes (P06.12.02); provider
  threat-protection signals, where the chosen tier provides them (P06.05.03).
- In the audit trail: role changes, invitations, exports, support grants or integration changes
  nobody in the business asked for.
- An MFA-reset request that fails verification, is pressing, or comes with a change of contact
  details ([MFA reset](mfa-reset.md)).
- A reported phishing message that asked for moin credentials.

## 1. Open the incident

1. Create an incident reference. Record detection time, reporter type, opaque organisation and user
   IDs, the signals observed and the initial severity. Keep raw request bodies, tokens, cookies,
   contact details and names out of the ticket, chat and logs (INV-12).
2. Identify the affected subject from our own records: membership → user → provider subject
   (REQUIRED CONTROL — implementation pending in P06.06–P06.08). Never select a tenant or a user
   because of a header, an email address or a phone number someone reported.
3. Assign an incident lead and set a **provisional severity**, until P15.10.01 defines severity for
   account compromise:
   - **SEV1** if anything suggests access outside the account's own organisation: a cross-tenant
     anomaly is a SEV1 page in the PLAN alerting table;
   - otherwise treat an owner, admin, billing, integration or operator account as at least **SEV2**,
     because of residual R-4.

## 2. Contain

1. **Revoke every server-side session of the subject**, and confirm that the next request with an
   old session fails (REQUIRED CONTROL — implementation pending in P06.06.05; tested by P06.06.07).
2. If revocation cannot be confirmed, **disable the membership** instead of deleting it
   (REQUIRED CONTROL — implementation pending in P06.08.03). A disabled member loses access on the
   next request, because every request re-checks membership (P06.06.03).
3. **Sign the subject out at the provider.** This stops the provider issuing and refreshing tokens,
   but a token it already issued can stay valid until it expires
   ([Cognito token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)),
   so it supplements steps 1 and 2 and never replaces them. The provider operation and the restricted
   operator role are defined with the MFA-reset procedure (P06.09.02) against the provisioned pool
   (P06.05.01).
4. **Revoke support access grants** the account created or used (REQUIRED CONTROL — implementation
   pending in P06.11.02).
5. **Integrations:** if the account could connect or change integrations (`integration_admin` or
   owner), list the organisation's integrations and revoke or rotate those the account touched,
   following ADR-0020 and P20.03.03. None exist on `main` today. Do not rotate other tenants'
   credentials.
6. **Audit each containment action** with its result, the operator as actor, opaque IDs, a reason
   code and the incident reference (REQUIRED CONTROL — implementation pending in P06.10.03,
   P06.11.04 and P06.12.02). If an audit write fails, record that in the incident: it is an
   integrity problem in its own right.

Never change roles or groups at the identity provider as a containment step. Roles live in our
database (ADR-0005), and provider claims never grant tenant access (EV-P06-038).

## 3. Preserve evidence

- Do not delete the user, the membership, sessions or any audit, log or provider record before the
  incident review. Revocation marks a session (`revoked_at`, `revocation_reason` in the planned
  `sessions` table) rather than deleting it.
- `audit_events` is append-only and hash-chained. Run the chain verifier (`pnpm db:verify-audit`)
  for the affected period; a break is a separate SEV2 incident under
  [audit chain break](audit-chain-break.md).
- Writer adoption is incomplete (P06.10.03): **missing audit events do not prove that nothing
  happened.** Corroborate with session records, provider sign-in history and security events once
  they exist.
- Snapshot what the review will need before remediation changes it, following the breach workflow
  (P15.10.02, not yet written).

## 4. Operator and support access

- If the suspect account is an **operator** account: revoke its operator-pool sessions and access,
  review every action recorded with that operator ID (P06.11.04), and assess notification for every
  tenant whose data it reached under a grant or emergency access.
- Investigating a customer tenant needs a customer-granted support grant (P06.11.02). Access
  without one is emergency access: it requires the incident reference and notifies the owner
  (P06.11.04). Operators never use a customer account.

## 5. Assess scope and impact

From the earliest plausible compromise time:

- sessions, sign-ins and devices; role and membership changes; invitations; exports; support
  grants; integration changes; business mutations by the subject;
- which callers' data was viewed or exported. Under R-4 this decides whether the customer, as
  controller, must notify;
- whether other members or other tenants were touched.

Use tenant-scoped queries and leave the original records unchanged. The audit query API (P06.10.04)
answers "by actor" and "by target", but there is no production operator access path to it yet
(P06.11.03).

## 6. Check tenant isolation, when authorisation may be involved

Tenant access comes from memberships in our database and is enforced by RLS (INV-01, INV-02); a
stolen provider identity should reach only that person's own memberships. If the evidence suggests
otherwise — data from another organisation, a role nobody granted, a membership that should not
exist:

- escalate to **SEV1**: this is a possible cross-tenant exposure, not an account problem;
- re-run the isolation suites (RLS: P06.02.06; route-level: P06.13 once built) against the release
  that was live;
- follow the incident process for cross-tenant exposure, the scenario P15.10.03 rehearses.

## 7. Recover the account

1. **Re-verify identity** with the full [MFA reset](mfa-reset.md) verification. Callback and
   billing data alone are not enough, and nothing supplied by the requester counts.
2. **Reset the password** through the provider's email flow (P06.09.01) only if the user's mailbox
   is not itself suspected; otherwise the owner of record decides on the next step under the MFA
   reset verification.
3. **Reset MFA** through [MFA reset](mfa-reset.md), so the next sign-in forces re-enrolment.
4. **Review the membership** with an owner of record: role, `integration_admin`, `billing_admin`.
   Restore least privilege and undo unauthorised role changes and invitations through the
   application (P06.07, P06.08), with last-owner protection (P06.07.04) — never at the identity
   provider.
5. **Notify the owner**, and the affected user if that is someone else, through a pre-existing
   verified channel (P06.12.02). If the owner account itself is the suspect one, reach the owner
   only after the [MFA reset](mfa-reset.md) verification.

## 8. Recovery criteria

The incident can move to monitoring only when all of these are recorded:

- old sessions fail on their next request, and the provider sign-out succeeded;
- the user signs in again only with a newly enrolled factor;
- memberships and roles match what an owner of record confirmed;
- the support grants and integrations the account touched are revoked or rotated;
- the scope assessment is written, including whether callers' data was affected;
- if authorisation was involved, the isolation re-check is recorded;
- the owner has been notified, and the breach assessment is done where personal data may be affected.

## 9. Notification and legal assessment

If personal data may be affected, the founder decides on notification following the breach workflow
(P15.10.02): the customer, as controller, is notified without undue delay — the contractual target
is ≤ 24 h after the breach is confirmed — with the Art. 33(3) information. This runbook sets no
other deadline.

## 10. After the incident

- Post-incident review within five business days (PLAN incident lifecycle).
- A regression test or eval case for whatever allowed the compromise.
- Update the risk register and the threat model (R-4) if the assumptions changed.
- Record any control that this runbook marked pending and that would have shortened the incident.

## Verification of this runbook

Not yet verified. P06.09.04 is a tabletop of this runbook and of [MFA reset](mfa-reset.md). Staging
proof of revocation, disabled-member access and forced re-enrolment depends on P06.05.05, P06.06.07
and P06.08.04.
