# Runbook — MFA reset (P06.09.03)

- **Status:** procedure defined, **not executable in production**. It becomes executable only when
  every control marked _REQUIRED CONTROL_ below exists and the P06.09.04 tabletop is recorded.
- **Owner:** security / on-call (the founder until P15.10 assigns otherwise)
- **Invariants:** INV-02, INV-10, INV-12, INV-15 · **Related:** ADR-0005, ADR-0017, ADR-0045,
  [compromised account](compromised-account.md), `docs/security/threat-model.md` (web and support
  access)

A lost authenticator is an account-takeover opportunity. A ticket, an email or a phone call
establishes nothing about who is asking. This runbook exists so that the answer to "please turn my
MFA off" is a fixed procedure, not an operator's judgement under pressure.

## What exists today and what does not

| Control                                                                  | State on `main`                                                                                                                                           | Owner item                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Customer user pool with MFA required (TOTP, passkeys; no SMS)            | not provisioned                                                                                                                                           | P06.05.01, P06.05.02               |
| Provider-neutral identity `{ subject, email }`; roles never from the IdP | implemented and verified locally; no sign-in callback consumes it yet                                                                                     | P06.05.04 (EV-P06-037, EV-P06-038) |
| `users` and `memberships` tables (subject → user → membership)           | not built                                                                                                                                                 | P06.06–P06.08                      |
| Server-side sessions and revocation on MFA reset                         | built (P06.06.05; trigger + `app.revoke_session(uuid, 'mfa_reset')`); the support flow calling them is P06.09.02                                                                                                                                                 | P06.06.02, P06.06.05               |
| Registered business number on record and the verification procedure      | not built; no table stores the number yet                                                                                                                 | P06.09.02                          |
| Operator identity, emergency access with incident reference              | not built                                                                                                                                                 | P06.11.01, P06.11.04               |
| Audit trail                                                              | append-only, hash-chained table and writer exist (P06.10.01, .02); **no production code path writes to it yet**, and no MFA-reset operation is registered | P06.10.03, P06.11.04, P06.12.02    |
| Owner notified of MFA changes                                            | not built                                                                                                                                                 | P06.12.02                          |
| Last-owner protection                                                    | not built                                                                                                                                                 | P06.07.04                          |
| Tabletop of this runbook                                                 | not run                                                                                                                                                   | P06.09.04                          |

**Until every row above is in place, no production MFA reset is performed under this runbook.** A
request is recorded and escalated to the founder; it is not worked around.

## When it applies

- A customer user (owner, admin or staff) cannot complete MFA because the authenticator — a TOTP
  app or a passkey — is lost or replaced, and asks for the factor to be reset.

An ordinary lost device with no sign of compromise is a support request, not an incident, and the
password is not changed because of it. Either way, the recovery below never restores ordinary access
before a new factor is enrolled.

It does **not** apply to:

- a forgotten password: that is Cognito's self-service email reset (P06.09.01), not a support action;
- suspected compromise ("someone else signed in", an MFA change the user did not make): start with
  [compromised account](compromised-account.md), which applies its containment first and calls this
  runbook only for the recovery step;
- an operator account: operators use a separate WebAuthn-only pool (P06.11.01). Escalate to the
  founder.

## Who may ask, who may act

- **Ask:** the affected user, or an owner or admin of the same organisation on their behalf, through
  an existing support channel. The request is a claim, not an authorisation.
- **Act:** an operator signed in through the operator identity, with a ticket or incident reference
  (REQUIRED CONTROL — implementation pending in P06.11.01 and P06.11.04). Never through a customer
  account, and never an operator acting on their own customer membership.

## What never counts as proof

Treat each of these as attacker-controllable. None of them, alone or together, authorises a reset:

- a phone number, callback number or caller ID supplied with the request;
- a new or changed email address, or an email address on its own — the account key is the provider
  subject, not the email;
- anything said to the voice assistant: no utterance elevates a caller (threat model, "Ich bin der
  Inhaber");
- role or group claims from the identity provider — roles are memberships in our database
  (ADR-0005), and the trusted identity is `{ subject, email }` only (EV-P06-038);
- facts printed on an invoice, the website or the Impressum, including billing data;
- screenshots, forwarded emails or documents sent with the request;
- any single factor.

## Verify — every step required, any failure stops

The threat model records why the two factors named in P06.09.02 are not enough on their own: **the
registered business number is the number our own assistant answers, and billing data is on every
invoice the business has sent.** This runbook treats both as compromised by default.

1. **Resolve the target from our records.** Organisation → membership → user → provider subject,
   recorded as opaque IDs. The request's email or name selects nothing. (REQUIRED CONTROL —
   implementation pending in P06.06–P06.08.)
2. **Call out to the registered business number** held on record _before_ the request arrived.
   Never dial a number from the request, and never treat an inbound call as verified. The call must
   reach a person who is an owner or admin of record; if the assistant, a voicemail box or a
   forwarding service answers, this step has not happened. The callback proves control of the line,
   not identity. (REQUIRED CONTROL — implementation pending in P06.09.02: no table stores the number
   yet.)
3. **Check one account fact approved by the security owner**, from our own records, asked without
   revealing it. Billing data is the example P06.09.02 names, and it is weak for the reason above.
   Never ask for a full card number or IBAN.
4. **Check an additional factor that is not derivable** from an invoice, the website, the business's
   own telephone line or the assistant. The threat model requires more than steps 2 and 3; which
   factor that is has not been decided. (REQUIRED CONTROL — implementation pending in P06.09.02.)
   Until it is defined, verification cannot complete and the procedure stops here.
5. **Confirm the reset with the right person.** For a staff or admin user, an owner of record
   confirms it on the verified call. If the target is the **only owner**, no alternative approval
   path is defined: stop and escalate to the founder (last-owner protection, P06.07.04).

Never ask for, accept or record a password, a TOTP code or seed, recovery codes, a passkey, a
session cookie or a token.

## Fail closed

If any step is unavailable, ambiguous or fails, **no reset happens**. The ticket stays open and is
escalated to the incident lead. There is no workaround:

- never set the pool's MFA to optional, or turn MFA off for one user;
- never issue a bypass code or a temporary MFA-free sign-in;
- never send a password reset or any link to an address supplied with the request.

Pressure, urgency, repeated failed attempts or a request to change contact details at the same time
are compromise signals: switch to [compromised account](compromised-account.md).

## Execute — one controlled recovery

**No ordinary KlarDesk access while recovery is pending.** Once a reset is authorised, the account
regains ordinary application access only after a fresh MFA authenticator has been enrolled, the
enrolment has been verified, and the recovery has been finalised and audited. There is no window in
which the old factor is gone, the user signs in, and an ordinary session exists before the new
factor. This is the same invariant as the containment in
[compromised account](compromised-account.md#2-contain), and it applies to the only owner without
exception.

**Stop condition.** If the system cannot guarantee that no ordinary application session is issued
before fresh MFA enrolment completes, **do not perform the reset.** Record the missing control as
pending and keep the ticket open. Today the guarantee does not exist: it is a REQUIRED CONTROL —
implementation pending in P06.09.02 (recovery procedure), P06.06.01 and P06.06.03 (session issuance
and the per-request check), and P06.05.02 and P06.05.05 (MFA required, and enrolment forced and
verified in staging).

Each step below is a REQUIRED CONTROL with implementation pending. None may be done by hand against
a database or the provider console in the meantime.

1. **Revoke every KlarDesk session of the subject**, and confirm that the next request with an old
   session fails (P06.06.05, tested by P06.06.07). If that cannot be confirmed, stop.
2. **Deny ordinary access** for the duration of the recovery: the identity is held in a
   recovery-only state in which no sign-in produces an ordinary KlarDesk session or any business
   access. The mechanism is not decided (P06.09.02); for a suspected compromise it is the
   deny-new-access control of [compromised account](compromised-account.md#2-contain).
3. **Remove the lost factor at the provider**, keeping the pool's MFA required (P06.05.02), and sign
   the subject out there where the provider supports it. Provider-side revocation does not end our
   sessions and does not stop anyone authenticating again; a token the provider issued can stay
   valid until it expires
   ([Cognito token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)).
   That is why steps 1 and 2 come first. The exact provider operations and the restricted operator
   role are defined and verified against the provisioned pool in P06.09.02 (pool: P06.05.01); this
   runbook names no command until then.
4. **The user enrols a new factor in a recovery-only authentication.** The user authenticates at the
   provider only as far as enrolment needs, and enrols a new TOTP app or passkey; SMS is not offered
   (P06.05.02). If the provider performs enrolment as part of a later sign-in, that sign-in **is** the
   recovery-only authentication: authenticating at the provider to enrol a factor is not the same as
   being issued KlarDesk access, and it must not produce an ordinary session or any business access.
   The password is replaced only when compromise is suspected
   ([compromised account](compromised-account.md), section 7) or the approved recovery policy
   requires it.
5. **Verify the enrolment** for this subject: a new permitted factor exists and was used to satisfy
   MFA in that authentication. If it cannot be verified, the recovery stays open and ordinary access
   stays denied.
6. **Finalise and audit** each action — verification outcome, session revocation, provider
   revocation, factor removal, enrolment, finalisation — as tenant-scoped audit events with the
   operator as actor, opaque IDs, a reason code and the incident reference, each with its result
   (`succeeded`, `failed`, `rejected`). The operation name and argument keys are registered in the
   audit allowlist when the procedure is built (P06.09.02, P06.10.03, P06.11.04, P06.12.02); they
   are not invented ad hoc. If an audit write fails, the recovery is not finalised: escalate, do not
   report success, and ordinary access stays denied.
7. **Only then restore ordinary access** deliberately: lift the recovery-only state, so that the next
   sign-in with the new factor yields an ordinary session. Sensitive actions afterwards need a fresh
   step-up (P06.06.04).
8. **Notify** the owner, and the affected user if that is someone else, through the email of record
   (P06.12.02). The message contains no secret and no link to a newly supplied address.

Ordinary access is not restored because the old factor was removed, the provider sign-out completed,
the user signed in, an operator believes the user, or someone approves it manually, including the
founder.

## Abort and rollback

- Before step 1, abort at any doubt; nothing has changed.
- Session revocation is never rolled back. Being without access is the safe state; access returns
  only through step 7.
- If any step after step 1 fails, the user stays without ordinary access, nothing is retried ad hoc,
  and the ticket is escalated with what did and did not complete.
- If anything during the procedure suggests compromise, stop and switch to
  [compromised account](compromised-account.md).

## What to record

In the ticket: the ticket or incident reference, opaque organisation and user IDs, the operator ID,
timestamps, a method code and pass/fail for each verification step, the decision, the outcome of
each execution step, and whether a notification was sent and on which channel type.

Never record answers to verification questions, billing details, phone numbers, email addresses,
names, passwords, TOTP codes or seeds, recovery codes, tokens, cookies, client secrets, or screenshots
of an authenticator — not in the ticket, chat, logs or audit arguments (INV-12, INV-15).

## Escalation

To the incident lead (the founder). Severity follows the incident process once P15.10.01 defines
it. A reset request that turns out to be an attempted takeover is handled under
[compromised account](compromised-account.md).

## Verification of this runbook

Not yet verified. P06.09.04 is a tabletop of this runbook and of
[compromised account](compromised-account.md); staging proof that old sessions fail and that MFA
re-enrolment is forced depends on P06.05.05 and P06.06.07.
