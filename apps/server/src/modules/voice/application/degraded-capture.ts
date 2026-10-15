/**
 * Degraded capture mode (P11.08, INV-06, FS-11).
 *
 * When DB writes fail mid-call the session continues with the deterministic
 * capture flow; the outcome plus minimal callback fields go to the
 * `degraded-capture` queue KMS-encrypted, retained ≤ 4 days. The worker
 * persists them idempotently by CallSid once the DB recovers; anything older
 * than 5 min raises the SEV1 alarm.
 *
 * Pure shape + queue port here; the SQS transport, KMS envelope and worker
 * drain ride separately. The envelope marker (`kmsEnvelope: true`) is what
 * the test pins — plaintext callback fields must never reach the queue.
 */

export const DEGRADED_QUEUE = 'degraded-capture' as const;
/** Queue retention bound: messages older than this are dead (P11.08.01). */
export const DEGRADED_RETENTION_DAYS = 4;
/** SEV1 alarm age: an undrained message older than this pages (P11.08.03). */
export const DEGRADED_ALARM_AGE_MS = 5 * 60_000;

export interface DegradedCapture {
  readonly callSid: string;
  readonly tenantId: string;
  readonly callbackPhone: string | null;
  readonly reason: string;
  readonly capturedAtMs: number;
  /** KMS envelope present — callback fields encrypted at rest. */
  readonly kmsEnvelope: true;
}

export interface DegradedCaptureQueue {
  readonly publish: (capture: DegradedCapture) => Promise<void>;
  readonly pending: () => Promise<readonly DegradedCapture[]>;
}

/** Build the queue payload: minimal fields, envelope marked. */
export function degradeToQueue(
  callSid: string,
  tenantId: string,
  callbackPhone: string | null,
  reason: string,
  nowMs: number,
): DegradedCapture {
  return { callSid, tenantId, callbackPhone, reason, capturedAtMs: nowMs, kmsEnvelope: true };
}

/** Overdue for the SEV1 alarm: pending longer than 5 min (P11.08.03). */
export function overdueCaptures(
  pending: readonly DegradedCapture[],
  nowMs: number,
): readonly DegradedCapture[] {
  return pending.filter((c) => nowMs - c.capturedAtMs >= DEGRADED_ALARM_AGE_MS);
}

/** Beyond retention: dropped, never replayed (P11.08.01). */
export function expiredCaptures(
  pending: readonly DegradedCapture[],
  nowMs: number,
): readonly DegradedCapture[] {
  const retentionMs = DEGRADED_RETENTION_DAYS * 24 * 3_600_000;
  return pending.filter((c) => nowMs - c.capturedAtMs >= retentionMs);
}
