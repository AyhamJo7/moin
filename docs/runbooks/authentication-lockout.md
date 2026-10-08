# Authentication lockout behaviour — Cognito, throttles, and what operators do

- **Status:** reference documentation for P06.12.01 (docs half). The application throttles are
  built and verified locally (EV-P06-058); the WAF rate rules are `WAITING_FOR_EXTERNAL`
  P05 / EXT-09; the Cognito user pool is not provisioned yet (P06.05.01, EXT-09).
- **Owner:** security / on-call (the founder until P15.10 assigns otherwise)
- **Invariants:** INV-02, INV-12 · **Related:** ADR-0045, P06.05.01, P06.06, P06.12.01,
  [compromised account](compromised-account.md), [MFA reset](mfa-reset.md)

Three independent layers can refuse a sign-in attempt, in this order: the WAF at the edge
(not built), our application throttles, and Cognito's own lockout. Each answers differently,
and a locked-out user must be told which one refused them — otherwise support "fixes" the
wrong layer and the user stays locked.

## 1. Cognito lockout (provider layer, staging/production only)

Source:
[Lockout behavior for failed sign-in attempts](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow.html#authentication-flow-lockout-behavior)
(AWS Cognito Developer Guide, retrieved 2026-10-08).

Documented behaviour, quoted so operators act on AWS's words and not on ours:

- After **5 failed password sign-in attempts**, Cognito locks the user out for **1 second**.
  The lockout duration then **doubles after each additional failed attempt**, up to a
  maximum of **approximately 15 minutes**.
- Attempts made **during** a lockout answer `Password attempts exceeded` and do **not**
  extend subsequent lockouts. For a cumulative count _n_ of failed attempts (excluding those
  exceptions), the lockout is _2^(n-5)_ seconds.
- The lockout resets to _n=0_ when the user **signs in successfully** after a lockout expires,
  or makes **no sign-in attempts for 15 consecutive minutes** at any point after a lockout.
- AWS marks this behaviour **subject to change**.
- It does **not** apply to custom challenges unless they also perform password-based
  authentication.

What this means in practice:

- A user who mistypes five times waits 1 s, then 2 s, 4 s, 8 s, … — short stutters, not a
  lockout worth supporting. Real support cases start around _n_ ≥ 10 (≈ 32 s and climbing).
- Hammering the form during a lockout neither helps nor hurts: those attempts are refused
  without touching the backoff counter. Tell the user to **stop trying for 15 minutes** —
  that alone resets the counter.
- Local development and automated tests never see this: the local Keycloak realm does not
  enable brute-force detection (no `bruteForceProtected` in
  `docker/keycloak/realm-moin-local.json`; Keycloak's protection is opt-in — see the
  [brute force protection](https://www.keycloak.org/docs/latest/server_admin/#brute-force-mitigation)
  section of the Server Administration Guide). Cognito lockout is verified against
  Cognito, never claimed from local evidence.

UNVERIFIED: whether the pool enables Cognito's advanced-security adaptive authentication
(block vs notify vs none) and its exact thresholds — decided at P06.05.01 provisioning,
not here. This document describes the base lockout above only.

## 2. Application throttles (our layer, all environments)

Source: `AuthThrottleGuard` / `AccountThrottleGuard`
(`apps/server/src/modules/identity-access/http/auth-throttle.guard.ts`), verified locally
(EV-P06-058). These run **before** the request reaches Cognito, so a throttled attempt never
becomes a Cognito failed attempt and never feeds the backoff above.

| Bucket      | Mount point                                     | Budget                   | Answers when exceeded                             |
| ----------- | ----------------------------------------------- | ------------------------ | ------------------------------------------------- |
| Per-IP      | first, before any session work                  | 200 burst, refills 1/s   | 429 `/problems/too-many-requests` + `Retry-After` |
| Per-account | after the session guard (verified subject only) | 50 burst, refills 50/min | same 429 shape                                    |

Bucked keying is HMAC-SHA256 of the IP or the verified subject — raw values are never
stored or logged (INV-12). The response never names the remaining budget. Behind the ALB
(P05) the WAF owns edge throttling (EXT-09); these guards are the application layer
beneath it.

Telling the layers apart for a user report:

- **Our 429** carries `type: /problems/too-many-requests` and a `Retry-After` header in
  seconds. The user waits out the seconds shown and retries.
- **Cognito lockout** surfaces as a sign-in failure naming exceeded password attempts
  (provider error text, not our problem type). The user stops for 15 minutes.
- **Both at once** is possible under credential-stuffing: obey the longer instruction
  (the 15-minute Cognito reset covers any throttle refill).

## 3. Operator procedure — a legitimately locked user

Preconditions: the requester proves who they are through the normal support identity check
(a ticket, email or call establishes nothing by itself — see [MFA reset](mfa-reset.md)).
Suspected compromise → [compromised account](compromised-account.md) first; this section is
for ordinary lockouts only.

1. **Identify the layer.** Ask what the user saw: a 429 with seconds (our throttle — go to
   step 2), or repeated sign-in failures over minutes (Cognito backoff — go to step 3).
   Both vague → assume Cognito and give the 15-minute instruction; it is harmless if the
   cause was our throttle.
2. **Our throttle:** no operator action exists or is needed — tell the user the
   `Retry-After` seconds and to retry once after waiting. Do not restart services or touch
   the database: buckets refill on their own, and a key rotation would reset every
   customer's bucket.
3. **Cognito lockout:** tell the user to **make no sign-in attempts for 15 consecutive
   minutes**, then sign in once, carefully. Any attempt during the 15 minutes restarts the
   quiet period. After one successful sign-in the counter is at zero.
4. **If the user still fails after a clean 15-minute quiet period**, treat it as not-a-lockout:
   wrong password (Cognito self-service email reset, P06.09.01), unverified email, or a
   disabled account — or escalate to the founder as a suspected compromise, never work
   around it with a manual database or provider-console change.
5. **Record** the ticket with the layer identified and the instruction given. Keep raw
   request bodies, tokens, cookies and contact details out of the ticket, chat and logs
   (INV-12).

## 4. What is still open (P06.12.01 remainder)

- WAF rate rules on auth endpoints: `WAITING_FOR_EXTERNAL` P05 / EXT-09. When they land,
  this document gains a section 0 (edge layer) with the rule IDs and thresholds.
- Cognito advanced-security mode and thresholds: decided at P06.05.01 provisioning; the
  UNVERIFIED note in section 1 is replaced with the chosen values then.
- Owner notification of security events (P06.12.02, P14 email) does not change this
  procedure, but gives operators the failed-login burst signal to identify the layer faster.
