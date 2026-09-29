/**
 * Single-use session tokens for the media WebSocket (P04.04.03, PLAN P11.04).
 *
 * ## Why a token and not just the signature
 *
 * The WebSocket handler needs to know which tenant and which call a connection belongs to. The
 * obvious answer — read `CallSid` from the `setup` message — is not an answer, because `CallSid`
 * is not a secret: it appears in every webhook body and in the tenant's own Twilio console. The
 * threat model rejected that binding for exactly this reason.
 *
 * So the binding is a secret we mint ourselves, put into the TwiML as a `<Parameter>`, and receive
 * back in `setup`. It is single-use and short-lived, which limits what a leaked TwiML document is
 * worth: sixty seconds, one connection, one call.
 *
 * ## What is stored
 *
 * The store holds a SHA-256 of the secret, never the secret. A store dump — a Valkey snapshot, a
 * support export, a log line — then yields nothing usable. `take` is destructive by contract:
 * claiming a token and deleting it must be one atomic step, or two connections racing the same
 * token both succeed. In Valkey that is `GETDEL`; the in-memory implementation below models the
 * same contract so tests exercise the real semantics.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Sixty seconds: long enough for Twilio to fetch the TwiML and connect, short enough to matter. */
export const SESSION_TOKEN_TTL_MS = 60_000;

const TOKEN_ID_BYTES = 12;
const TOKEN_SECRET_BYTES = 32;

export interface StoredSessionToken {
  readonly id: string;
  /** SHA-256 of the secret, hex. */
  readonly secretHash: string;
  readonly tenantId: string;
  readonly expiresAtMs: number;
}

export interface SessionTokenStore {
  put(record: StoredSessionToken): Promise<void>;
  /** Atomically returns and removes the record. A second call for the same id returns undefined. */
  take(id: string): Promise<StoredSessionToken | undefined>;
}

export interface IssuedSessionToken {
  /** The value that goes into the TwiML `<Parameter>`. Never logged, never persisted. */
  readonly token: string;
  readonly record: StoredSessionToken;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Mints a token bound to a tenant, valid for {@link SESSION_TOKEN_TTL_MS}. */
export async function issueSessionToken(
  store: SessionTokenStore,
  tenantId: string,
  nowMs: number,
): Promise<IssuedSessionToken> {
  if (tenantId === '') {
    throw new Error('issueSessionToken requires a tenant id');
  }
  const id = randomBytes(TOKEN_ID_BYTES).toString('base64url');
  const secret = randomBytes(TOKEN_SECRET_BYTES).toString('base64url');
  const record: StoredSessionToken = {
    id,
    secretHash: hashSecret(secret),
    tenantId,
    expiresAtMs: nowMs + SESSION_TOKEN_TTL_MS,
  };
  await store.put(record);
  return { token: `${id}.${secret}`, record };
}

export type SessionTokenVerdict =
  | { readonly ok: true; readonly tenantId: string }
  | {
      readonly ok: false;
      readonly reason: 'malformed' | 'unknown-or-used' | 'expired' | 'mismatch';
    };

/**
 * Claims a token exactly once.
 *
 * `unknown-or-used` deliberately conflates "never existed" with "already used": distinguishing
 * them tells an attacker which token ids are real.
 */
export async function consumeSessionToken(
  store: SessionTokenStore,
  token: string,
  nowMs: number,
): Promise<SessionTokenVerdict> {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, reason: 'malformed' };
  }
  const id = token.slice(0, separator);
  const secret = token.slice(separator + 1);

  const record = await store.take(id);
  if (record === undefined) {
    return { ok: false, reason: 'unknown-or-used' };
  }
  if (nowMs >= record.expiresAtMs) {
    return { ok: false, reason: 'expired' };
  }
  if (!constantTimeEquals(hashSecret(secret), record.secretHash)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, tenantId: record.tenantId };
}

/**
 * An in-process store for the spike and for tests.
 *
 * Not for production with more than one instance: two voice processes would not see each other's
 * tokens, and a caller would be rejected depending on which one answered. P11 replaces it with
 * Valkey `GETDEL`, which is why `take` here is written to be destructive rather than convenient.
 */
export function createInMemorySessionTokenStore(): SessionTokenStore & { readonly size: number } {
  const records = new Map<string, StoredSessionToken>();
  return {
    get size(): number {
      return records.size;
    },
    put(record: StoredSessionToken): Promise<void> {
      records.set(record.id, record);
      return Promise.resolve();
    },
    take(id: string): Promise<StoredSessionToken | undefined> {
      const record = records.get(id);
      records.delete(id);
      return Promise.resolve(record);
    },
  };
}
