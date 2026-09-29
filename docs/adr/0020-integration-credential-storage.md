# ADR-0020 — Integration credential storage

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0033, INV-15, INV-12, QG-09

## Context

When an owner connects their Google Calendar or their mailbox, the system receives an OAuth refresh
token. That token is a long-lived key to a customer's calendar and mail. There will be one per
tenant per integration, they rotate, and they must be revocable.

The obvious place to put them is a database column, and that is the decision this ADR exists to
refuse.

## Decision

**Every integration credential lives in AWS Secrets Manager. The database stores the ARN.**

A tenant's integration row holds `secret_arn`, never a secret. Resolution happens at use, by the
role that needs it, and the resolved value never reaches a log, a metric, an audit argument or an
error message (INV-12, INV-15).

**KMS encrypts each secret**, with a key per data class (ADR-0033), so access is auditable in
CloudTrail and revocable by key policy independently of the application.

**Rotation happens on refresh.** An OAuth refresh returns a new token; the new version is written
to the same secret, and the previous version stays available for the rotation window so an
in-flight request does not fail.

**Revocation is deleting the secret**, not clearing a column. The row remains, so the audit trail
and the integration's health history survive, and the credential does not.

### The alternative, recorded with its trigger

**KMS envelope encryption in PostgreSQL**: a data key per tenant, encrypted by KMS, with the
ciphertext in a column. Cheaper at high tenant counts, because Secrets Manager charges per secret
per month and this design creates one per tenant per integration.

That cost only becomes material in the thousands. **Trigger: if the monthly Secrets Manager bill
exceeds the engineering cost of the migration — roughly 2,000 secrets — revisit.** Recorded now so
the decision is a measurement rather than a rewrite done in a hurry.

## Alternatives considered

| Option                                                | Why not                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A plain database column**                           | A database backup, a read replica, a support query, a leaked dump or a SQL injection all become credential disclosure for every tenant at once. This is the failure this ADR exists to prevent. |
| **An encrypted column with a key in the environment** | Moves the problem: the key is in an environment variable, so a process dump or a misconfigured log reveals it, and rotating it means re-encrypting everything.                                  |
| **KMS envelope encryption in PostgreSQL**             | Genuinely reasonable, and cheaper at scale — kept as the recorded alternative with a trigger rather than rejected. Today it means more code we own on the path that must not be subtly wrong.   |
| **HashiCorp Vault**                                   | Another stateful system to operate and back up, for something Secrets Manager already does inside the account the rest of the system lives in.                                                  |

## Consequences

- One Secrets Manager entry per tenant per integration, with a per-secret monthly cost. Explicitly
  measured against the trigger above.
- A resolution call in the path of every integration use. Cached in memory for a short TTL, never
  written to disk.
- Local development uses fake values from the example environment file, so no developer machine
  ever holds a real customer credential.
- Rotation is a real code path rather than a hope, and must be tested with an expired credential.
- **This is the wrong call if** tenant counts grow far faster than revenue per tenant; the trigger
  above is the measurement.

## Verification

| Enforcement                                       | Where                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| No credential column exists                       | Schema check: integration tables carry `secret_arn`, and the RLS catalog check fails on a column named like a secret |
| No secret reaches a log, metric or audit argument | Redaction allowlist (INV-12) plus the audit argument sanitiser (ADR-0017)                                            |
| A resolved secret is never persisted              | Code review scope (QG-09) plus a test asserting the cache is memory-only with a TTL                                  |
| Rotation works                                    | Integration test with an expired refresh token, asserting recovery without manual intervention                       |
| Revocation takes effect                           | Test: delete the secret, assert the integration reports unhealthy rather than failing silently                       |
| No secret in the repository                       | gitleaks over full history, every pull request                                                                       |
