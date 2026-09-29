# Provider accounts

- **Status:** skeleton — nothing here is configured yet
- **Owner:** founder. Account creation, plan upgrades and credential rotation are founder-only in
  every environment (CLAUDE.md §12).

> **No secrets in this file, ever.** Account identifiers, owners, regions and plan tiers only.
> Credentials live in AWS Secrets Manager and are referenced by ARN (INV-15); until Secrets Manager
> exists (P05.08) they live in the founder's password manager and nowhere else — not in this
> repository, not in a ticket, not in a chat message.

## What each row must say before an integration is called done

An account is not "set up" because a login exists. For each provider: who owns it, which region it
processes in, whether a DPA is signed, which environments it serves, and where its credentials are.
A missing cell is the point of the table.

## Twilio (EXT-10)

|                   |                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Status            | **NOT_STARTED**                                                                                          |
| Account SID       | —                                                                                                        |
| Business profile  | not submitted                                                                                            |
| DPA               | not signed                                                                                               |
| Processing region | IE1 intended (ADR-0010) — **not enabled**                                                                |
| Subaccounts       | `staging`, `production`, `monitor` — not created                                                         |
| Geo permissions   | outbound voice and SMS to Germany only; international and premium destinations disabled — not configured |
| Usage triggers    | daily and monthly spend thresholds to founder alerts — not configured                                    |
| Credentials       | —                                                                                                        |
| Blocks            | P04.01, P04.04.06, P04.05, P11                                                                           |

Toll fraud is the reason geo permissions and usage triggers are in this table rather than in a
runbook: an account that can dial premium international destinations is a liability from the
moment it is created, not from the moment it is used.

## German numbers (EXT-11)

|                        |                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Status                 | **NOT_STARTED**                                                                           |
| End user of the number | **undecided** — founder Gewerbe, UG, or the customer's business (P04.02.01, needs EXT-03) |
| Regulatory bundle      | not submitted                                                                             |
| Documents              | ≤ 1 year old, address inside the area code, no P.O. box — not prepared                    |
| Numbers                | staging test, canary tenant, Gurlitt pilot (040), monitor/harness caller — none acquired  |
| Blocks                 | P04.02, P04.05, the pilot                                                                 |

The end-user decision gates the bundle, and the bundle takes up to three business days to review
after it is correct. It is the longest lead time in P04 that is entirely within the founder's
control to start.

## OpenAI (EXT-12)

|                    |                                                                      |
| ------------------ | -------------------------------------------------------------------- |
| Status             | **NOT_STARTED**                                                      |
| Project            | a **new** project with Europe data residency — not created           |
| Enhanced privacy   | modified abuse monitoring / ZDR — not requested                      |
| DPA                | not signed                                                           |
| `store`            | must be `false` on every call                                        |
| Budget limits      | not set                                                              |
| Eligible endpoints | Responses API, strict structured outputs, embeddings — not confirmed |
| Credentials        | —                                                                    |
| Blocks             | P04.03, P10                                                          |

## Alternative EU model provider (DG-14)

|                    |                                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| Status             | **NOT SELECTED**                                                                 |
| Candidates         | Azure OpenAI EU Data Zone · AWS Bedrock eu-central-1 · Mistral                   |
| Selection criteria | strict structured outputs, measured latency from eu-central-1, DPA, EU residency |
| Blocks             | P10.02, P16.08                                                                   |

Deliberately not chosen from a datasheet. Structured-output behaviour and latency differ per
provider and both are measured (ADR-0012).

## AWS (EXT-09)

|        |                                     |
| ------ | ----------------------------------- |
| Status | **NOT_STARTED** — blocks all of P05 |
| Region | eu-central-1                        |
| DPA    | AWS standard terms                  |

## Stripe, Google, Microsoft, PostHog

Not required for the pilot. Tracked in P04.09 and P04.10, and in the Status Ledger with dates and
fallbacks.

## Rotation

When Secrets Manager exists (P05.08), every credential above is stored there and referenced by ARN.
Rotation procedure, owners and cadence are P18. Until then the rule is the narrow one: the founder
holds them, they are never pasted into a session, a ticket or a chat, and this file records only
that they exist.
