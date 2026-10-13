/**
 * CallSid idempotency (P11.03.04, INV-11).
 *
 * Twilio retries webhooks; a retried inbound for the same CallSid must
 * produce the same outcome without a duplicate effect — no second session
 * token minted, no second row, no second metric. The store is a port (Valkey
 * `GETDEL` in production, in-memory in tests); this module owns the
 * check-and-claim order, not the storage.
 */

export interface CallClaim {
  readonly callSid: string;
  readonly outcome: 'twiml-issued' | 'unassigned-number';
  readonly token: string | null;
}

export interface CallDedupStore {
  /** Returns the prior claim, or null when this CallSid is new. */
  readonly find: (callSid: string) => Promise<CallClaim | null>;
  /** Records the claim; overwrites nothing (first write wins). */
  readonly claim: (claim: CallClaim) => Promise<void>;
}

export function createInMemoryCallDedup(): CallDedupStore & { readonly size: number } {
  const claims = new Map<string, CallClaim>();
  return {
    get size(): number {
      return claims.size;
    },
    find(callSid: string): Promise<CallClaim | null> {
      return Promise.resolve(claims.get(callSid) ?? null);
    },
    claim(claim: CallClaim): Promise<void> {
      if (!claims.has(claim.callSid)) claims.set(claim.callSid, claim);
      return Promise.resolve();
    },
  };
}
