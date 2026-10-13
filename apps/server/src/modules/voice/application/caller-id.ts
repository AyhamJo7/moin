/**
 * Caller-ID classification (P11.11, FS-26, P07.03).
 *
 * `From` is classified before anything else: present, withheld (CLIR /
 * anonymous), tenant-owned (the business's own numbers — a PBX substitutes
 * them on forwarded calls, so they must never resolve identity), or
 * suspicious (invalid shape, premium ranges). Tenant-owned and suspicious
 * numbers never feed identity resolution; withheld and tenant-owned always
 * collect the callback number with read-back instead of offering the
 * "call back on this number" shortcut.
 */

export type CallerIdClass = 'present' | 'withheld' | 'tenant-owned' | 'suspicious';

/** German rule labels for the callback flow (P11.11.02). */
export const CALLBACK_OFFER =
  'Dürfen wir Sie unter der Nummer zurückrufen, von der Sie anrufen?' as const;

/** Premium ranges never dialled back blindly (0190/0900/0137). */
const PREMIUM = /^(?:\+49(?:900|137)|\+(?:0900|0190))/;

const WITHHELD = new Set(['anonymous', 'unknown', 'withheld', '', '+0']);

/**
 * Classify `From`. `tenantNumbers` are the business's own E.164 numbers
 * (from number_routes) — a forwarded call presents one of them as `From`
 * (FS-26), and it must never resolve identity (P07.03).
 */
export function classifyCallerId(from: string, tenantNumbers: ReadonlySet<string>): CallerIdClass {
  const trimmed = from.trim();
  if (WITHHELD.has(trimmed.toLowerCase()) || trimmed === '') return 'withheld';
  if (tenantNumbers.has(trimmed)) return 'tenant-owned';
  if (PREMIUM.test(trimmed)) return 'suspicious';
  if (!/^\+[1-9][0-9]{6,14}$/.test(trimmed)) return 'suspicious';
  return 'present';
}

/** True when the number may feed identity resolution (P07.03, P11.11.03). */
export function usableForIdentity(cls: CallerIdClass): boolean {
  return cls === 'present';
}

/** True when the callback number must always be collected + read back. */
export function mustCollectCallback(cls: CallerIdClass): boolean {
  return cls === 'withheld' || cls === 'tenant-owned' || cls === 'suspicious';
}
