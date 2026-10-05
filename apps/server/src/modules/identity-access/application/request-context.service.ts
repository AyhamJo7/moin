/**
 * The per-request session + membership re-check (P06.06.03, FS-16, INV-01, INV-02).
 *
 * Every request resolves its bearer once through `app.resolve_request_context` — one DEFINER call
 * that returns the session's user plus each *active* membership, or nothing when the session is
 * expired, revoked, its user inactive, or no active membership exists. The organisation the
 * request acts for comes out of that function, never out of a body, query string or header: a
 * removed member has no row and a disabled one is refused, so either way the next request fails
 * without any session sweep.
 *
 * Exactly one active membership resolves silently. Zero rows — or several — are both 401: several
 * means the caller holds sessions in more than one organisation and must choose (P06.07 org
 * selection), and guessing one for them would act for the wrong tenant.
 *
 * Cache: read-only GETs may reuse a resolution for at most 30 seconds; every mutation
 * (POST/PUT/PATCH/DELETE and anything else) resolves fresh. A stale membership therefore costs
 * at most 30 seconds of reads, never a write. The cache is process-local and keyed by the token
 * digest hex: entries hold identifiers and expiries only, never secrets, and eviction is by
 * timestamp on read — no timers, no sweep.
 */

import type { ActiveMembership, IdentityStore, RequestContext } from '@moin/db';
import type { Clock } from '@moin/kernel';

/** What the guard attaches to the request for the interceptor and handlers. */
export interface SessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly organisationId: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

export type ContextFailure = 'no_session' | 'invalid' | 'ambiguous_organisation' | 'unavailable';

/** 30 seconds: the PLAN ceiling for read-only GET reuse. */
export const CONTEXT_CACHE_TTL_MS = 30_000;

interface CachedEntry {
  readonly expiresAtMs: number;
  readonly context: SessionContext;
}

function singleMembership(context: RequestContext): ActiveMembership | undefined {
  return context.memberships.length === 1 ? context.memberships[0] : undefined;
}

function toSessionContext(context: RequestContext): SessionContext | undefined {
  const membership = singleMembership(context);
  if (membership === undefined) return undefined;
  return {
    sessionId: context.sessionId,
    userId: context.userId,
    organisationId: membership.organisationId,
    role: membership.role,
    permissions: membership.permissions,
  };
}

export class RequestContextService {
  readonly #store: IdentityStore;
  readonly #clock: Clock;
  readonly #cache = new Map<string, CachedEntry>();
  #lookups = 0;

  constructor(store: IdentityStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  /** Database lookups performed: the mutation-bypass test asserts on this, never on timing. */
  get lookups(): number {
    return this.#lookups;
  }

  /**
   * Resolve the presented token to the organisation it may act for. `useCache` is true only for
   * read-only GETs; mutations always pass false and hit the database.
   */
  async resolve(
    tokenHash: Buffer,
    useCache: boolean,
  ): Promise<{ context: SessionContext } | { failure: Exclude<ContextFailure, 'no_session'> }> {
    const key = tokenHash.toString('hex');
    if (useCache) {
      const hit = this.#cache.get(key);
      if (hit !== undefined && hit.expiresAtMs > this.#clock.now().getTime()) {
        return { context: hit.context };
      }
      this.#cache.delete(key);
    }
    this.#lookups += 1;
    const resolved = await this.#store.resolveRequestContext(tokenHash);
    if (resolved === undefined) return { failure: 'invalid' };
    const context = toSessionContext(resolved);
    if (context === undefined) return { failure: 'ambiguous_organisation' };
    if (useCache) {
      this.#cache.set(key, {
        expiresAtMs: this.#clock.now().getTime() + CONTEXT_CACHE_TTL_MS,
        context,
      });
    }
    return { context };
  }

  /** Drop cached entries; used by tests to prove expiry without waiting 30 real seconds. */
  clearCache(): void {
    this.#cache.clear();
  }
}
