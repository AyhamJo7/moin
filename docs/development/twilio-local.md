# Twilio in local development

**Developer machines only.** This path never applies to staging or production, and nothing here
may be reused for a real number (P02.04.04).

## The problem

Twilio calls a webhook over the public internet. A voice service running on a laptop has no public
URL, so a tunnel is the only way to exercise the real ConversationRelay handshake before the cloud
environment exists (P05).

A tunnel is also the riskiest thing in a developer setup: it publishes a local port to the internet
for as long as it is open. So the rules below are narrow on purpose.

## Rules

1. **Sandbox numbers only.** Never point a tunnel at a number that a customer, the pilot business
   or any real caller might dial. A real caller reaching a laptop is an incident, not a test.
2. **The tunnel is developer-local.** Staging and production receive webhooks on their real
   hostnames through the load balancer. No tunnel is ever part of a deployed environment, and no
   tunnel URL is ever configured on a production number.
3. **Signature validation stays on.** `packages/telephony` validates the `X-Twilio-Signature`
   header in every environment. Disabling it locally would mean the one control protecting the
   webhook is never exercised until production.
4. **The tunnel is closed when you stop working.** An idle tunnel is an open inbound path to a
   machine that also holds source code and credentials.
5. **Credentials live in the environment, never in a tunnel config.** The auth token is referenced
   from AWS Secrets Manager by ARN in deployed environments (INV-15); locally it is a placeholder
   until the founder supplies a sandbox credential (EXT-10).
6. **Recordings stay off.** INV-07 forbids persisting raw call audio; a local experiment that
   enables recording creates exactly the artefact the invariant exists to prevent.

## Shape of the setup

```text
Twilio (sandbox number)
   │  HTTPS webhook  +  WSS ConversationRelay
   ▼
tunnel (developer-local, ephemeral URL)
   ▼
http://127.0.0.1:3001   main-voice
```

The voice role listens on its own port so the tunnel exposes only that role — not the owner API,
and not the datastores.

## When this is used

Not in P02. The voice service arrives in **P11**, and the protocol simulator in
`packages/telephony` is the primary development path precisely because it needs no tunnel, no
account and no network: it replays recorded ConversationRelay message sequences against the local
service.

The tunnel is for the cases the simulator cannot reach — real codec negotiation, real network
jitter, real carrier behaviour — and those are confirmed against staging (P05) and the test-caller
harness (P11.17) rather than a laptop.

## What is deliberately not written here

No tunnel provider is named and no command is given. Choosing one and registering a sandbox number
needs a Twilio account (EXT-10), which is a founder action; documenting a specific tool before that
decision would be guessing. P11 records the choice in an ADR alongside the account setup.
