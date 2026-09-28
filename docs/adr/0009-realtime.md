# ADR-0009 — Realtime

- **Status:** ACCEPTED (P03.01.02, 2026-09-29) · **Deciders:** founder · **Phase:** P03
- **Related:** ADR-0007, INV-06, INV-12

## Context

A call is happening now. The owner's Today screen should show the resulting task without them
refreshing — that immediacy is much of what makes the product feel like a front office rather than
a report.

The traffic is one-directional: the server tells the browser something changed. The browser's
writes go through the normal API.

## Decision

**Server-Sent Events**, one stream per authenticated session, fanned out across instances with
Valkey pub/sub.

SSE rather than WebSockets because the need is one-directional. SSE is plain HTTP: it carries the
session cookie, passes proxies and corporate networks that mangle WebSocket upgrades, and
reconnects automatically with `Last-Event-ID`. A WebSocket would add a second authentication path
and a second connection lifecycle for a capability not needed.

**`Last-Event-ID` replay is served from the database, not from a buffer.** On reconnect the client
sends the last id it saw and receives what it missed. An in-memory buffer loses exactly the events
spanning a deploy — which is when reconnects happen.

**Events carry identifiers, not data** (as in ADR-0007). The client re-fetches through the normal
authorized, tenant-scoped API. Personal data never rides the stream, so the realtime path is not a
second place to get INV-12 wrong, and a subscriber cannot receive something the API would have
refused them.

**Polling fallback.** If the stream cannot be established, the client polls on a slower interval.
Degraded, not broken.

**Per-session, not per-tenant, streams.** A stream is authorized once for a session and filtered to
what that user may see. A shared tenant channel would make every subscriber's filtering a
correctness requirement rather than a display detail.

## Alternatives considered

| Option                                       | Why not                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebSockets**                               | Bidirectional capability that is not needed, plus a second authentication path and a second lifecycle. `apps/server` already uses WebSockets for ConversationRelay, which is genuinely bidirectional and real-time; the owner app is not. |
| **Long polling**                             | Works, and costs a request per interval per client plus latency no better than polling on a timer. SSE is simpler once the fan-out exists.                                                                                                |
| **A hosted realtime service (Pusher, Ably)** | Another subprocessor with personal-data implications for a capability that is one endpoint and a pub/sub channel.                                                                                                                         |
| **In-memory replay buffer**                  | Loses events across a deploy, which is precisely when clients reconnect.                                                                                                                                                                  |
| **Tenant-wide channels**                     | Makes correct filtering a subscriber-side requirement; a bug there is a cross-user leak.                                                                                                                                                  |

## Consequences

- A long-lived connection per active session, consuming a worker slot for its duration. Fastify
  handles this well; it is capacity to plan for rather than a surprise.
- A deploy drops every stream at once and they all reconnect together. Reconnect is jittered so the
  herd does not arrive in one instant.
- Replay requires events to be durable and queryable, which is the same table the outbox already
  needs.
- Because the client re-fetches, an event is a hint rather than a source of truth. That is the
  property that keeps authorization in one place.
- **This is the wrong call if** the owner app ever needs low-latency bidirectional interaction —
  live collaborative editing, for instance. It does not.

## Verification

| Enforcement                                          | Where                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| A stream delivers only what the session may see      | Cross-tenant suite includes SSE channels (P06.02.06)                    |
| `Last-Event-ID` replay is gapless across a reconnect | Integration test: disconnect, mutate, reconnect, assert no missed event |
| No personal data on the stream                       | Schema test: SSE payloads are id-only (INV-12)                          |
| Polling fallback engages when the stream fails       | Fault-injection e2e with the stream blocked                             |
| Reconnect does not stampede                          | Jitter asserted in the client reconnect test                            |
