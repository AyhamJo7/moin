/**
 * Call debug timeline (P15.06.01): per-call assembly of voice, session, NLU,
 * tool and notification events in timestamp order — codes and latencies,
 * never caller text (ADR-0019, INV-12). Pure; the ops CLI reads these
 * shapes under a support grant (P15.06.02 rides separately).
 */

export type TimelineKind =
  | 'webhook'
  | 'session'
  | 'turn'
  | 'nlu'
  | 'policy'
  | 'tool'
  | 'fallback'
  | 'outcome'
  | 'notification'
  | 'usage';

export interface TimelineEvent {
  readonly atMs: number;
  readonly kind: TimelineKind;
  readonly code: string;
  readonly latencyMs?: number | undefined;
}

/** Order events by timestamp, stable for equal timestamps. */
export function orderTimeline(events: readonly TimelineEvent[]): readonly TimelineEvent[] {
  return [...events]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.atMs - b.event.atMs || a.index - b.index)
    .map(({ event }) => event);
}

/** True when the event carries no caller text — code + numbers only. */
export function eventIsRedacted(event: TimelineEvent): boolean {
  if (event.code.length === 0 || event.code.length > 80) return false;
  if (event.latencyMs !== undefined && (!Number.isFinite(event.latencyMs) || event.latencyMs < 0)) {
    return false;
  }
  return true;
}
