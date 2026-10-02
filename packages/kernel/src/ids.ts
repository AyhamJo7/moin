/**
 * Identifiers (Data Architecture: "IDs: UUIDv7 (time-ordered) generated in the application").
 *
 * RFC 9562 §5.7: a 48-bit Unix millisecond timestamp, the version nibble `7`, the `10` variant,
 * and 74 random bits. Time-ordered so that index inserts stay local; random enough that an id is
 * never a capability — nothing may treat knowing one as permission to act.
 *
 * The timestamp comes from the injected clock, so a test with a fixed clock gets ordered, stable
 * timestamps; the random bits always come from the platform CSPRNG.
 */

import { randomBytes } from 'node:crypto';
import type { Clock } from './clock.ts';
import { systemClock } from './clock.ts';

const UUID_BYTES = 16;
const TIMESTAMP_BYTES = 6;
const MAX_TIMESTAMP_MS = 2 ** 48 - 1;
const VERSION_7 = 0x70;
const VARIANT_RFC = 0x80;

export function uuidv7(clock: Clock = systemClock): string {
  const ms = clock.now().getTime();
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMESTAMP_MS) {
    throw new RangeError('clock time is outside the UUIDv7 timestamp range');
  }
  const bytes = randomBytes(UUID_BYTES);
  bytes.writeUIntBE(ms, 0, TIMESTAMP_BYTES);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | VERSION_7;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | VARIANT_RFC;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
