/**
 * Session registry and idle detection (P11.04.02/.04).
 *
 * At most MAX_SESSIONS live connections per instance; the (MAX+1)th is
 * refused so the ALB and autoscaling see saturation instead of a slow
 * death. `saturated()` is the readiness signal. Idle connections — no frame
 * for IDLE_TIMEOUT_MS — close with a finaliser run, as does any socket close
 * without `end` (the connection object already transitions; this registry
 * only tracks membership so the count stays honest).
 */

export const MAX_SESSIONS = 20;
export const IDLE_TIMEOUT_MS = 5 * 60_000;

export interface RegistryEntry {
  readonly sessionId: string;
  readonly callSid: string;
  lastFrameAtMs: number;
}

export function createSessionRegistry(): {
  readonly size: number;
  readonly saturated: () => boolean;
  readonly admit: (entry: RegistryEntry) => boolean;
  readonly touch: (sessionId: string, atMs: number) => void;
  readonly release: (sessionId: string) => void;
  readonly idle: (nowMs: number) => readonly string[];
} {
  const entries = new Map<string, RegistryEntry>();
  return {
    get size(): number {
      return entries.size;
    },
    saturated(): boolean {
      return entries.size >= MAX_SESSIONS;
    },
    admit(entry: RegistryEntry): boolean {
      if (entries.size >= MAX_SESSIONS) return false;
      entries.set(entry.sessionId, entry);
      return true;
    },
    touch(sessionId: string, atMs: number): void {
      const entry = entries.get(sessionId);
      if (entry !== undefined) entry.lastFrameAtMs = atMs;
    },
    release(sessionId: string): void {
      entries.delete(sessionId);
    },
    idle(nowMs: number): readonly string[] {
      return [...entries.values()]
        .filter((e) => nowMs - e.lastFrameAtMs >= IDLE_TIMEOUT_MS)
        .map((e) => e.sessionId);
    },
  };
}
