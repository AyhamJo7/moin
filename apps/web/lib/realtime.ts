/**
 * Realtime connection state (P13.10.01–.02): owner UI mirrors the P08.08 SSE
 * stream — live while frames arrive, stale after 2 min of silence, polling
 * fallback when the stream is down. Pure transitions; the EventSource wiring
 * and the E2E ride separately.
 */

export type RealtimeState = 'live' | 'stale' | 'offline';

/** Stale threshold: 2 min without a frame (P13.10.02). */
export const REALTIME_STALE_MS = 120_000;

/** Last seen event id — the Last-Event-ID the reconnect carries (P08.08.02). */
export interface RealtimeCursor {
  readonly lastEventId: number;
  readonly lastSeenAtMs: number;
}

/** Advance the cursor on an inbound frame. */
export function onFrame(cursor: RealtimeCursor, eventId: number, nowMs: number): RealtimeCursor {
  return { lastEventId: Math.max(cursor.lastEventId, eventId), lastSeenAtMs: nowMs };
}

/** Connection state from silence: live under the threshold, stale past it. */
export function connectionState(cursor: RealtimeCursor, nowMs: number): RealtimeState {
  return nowMs - cursor.lastSeenAtMs > REALTIME_STALE_MS ? 'stale' : 'live';
}

/** Degraded fallback: poll while stale or offline, never while live. */
export function shouldPoll(state: RealtimeState): boolean {
  return state !== 'live';
}
