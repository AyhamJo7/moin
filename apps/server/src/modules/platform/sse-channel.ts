/**
 * SSE channel addressing + wire format (P08.08.01–.02, ADR-0009).
 *
 * Channel = organisation + user (P08.08.01): a stream never crosses either
 * boundary. The wire format is stock SSE — `id:` carries the stream event_id
 * (Last-Event-ID reconnects), `event:` the type, `data:` the JSON payload —
 * with a `: heartbeat` comment every 20 s (P08.08.01) keeping NATs and
 * proxies from killing idle streams.
 *
 * Pure functions, no I/O: the controller owns auth (session) and the store
 * owns replay (P08.08.02); this module is the format both ends share.
 */

/** Heartbeat interval: 20 s (P08.08.01). */
export const SSE_HEARTBEAT_S = 20;

/** Degraded poll interval when Valkey is down: 30 s (P08.08.03). */
export const SSE_DEGRADED_POLL_S = 30;

export interface SseFrame {
  readonly eventId: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, string>>;
}

/** Channel name for pub/sub: scoped to org + user, never broader. */
export function channelFor(organisationId: string, userId: string): string {
  return `sse:${organisationId}:${userId}`;
}

/** Render one event frame (id + event + data lines). */
export function renderFrame(frame: SseFrame): string {
  return `id: ${String(frame.eventId)}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame.payload)}\n\n`;
}

/** Heartbeat comment (P08.08.01): no id, no dispatch — keeps the stream alive. */
export function renderHeartbeat(): string {
  return `: heartbeat\n\n`;
}

/**
 * Parse a Last-Event-ID header value: a non-negative integer, or null when
 * absent/unparseable (a garbage header replays from the window start, never
 * an error — reconnects must be forgiving).
 */
export function parseLastEventId(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
