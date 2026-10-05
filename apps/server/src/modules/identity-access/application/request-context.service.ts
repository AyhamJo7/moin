/**
 * The per-request session + membership re-check (P06.06.03, FS-16, INV-01, INV-02).
 *
 * Every request resolves its bearer through `app.resolve_request_context` — one DEFINER call that
 * returns the session's user plus each *active* membership, or nothing when the session is
 * expired, revoked, its user inactive, or no active membership exists. The organisation the
 * request acts for comes out of that function, never out of a body, query string or header: a
 * removed member has no row and a disabled one is refused, so either way the next request fails
 * without any session sweep.
 *
 * Exactly one active membership resolves silently. Zero rows — or several — are both 401: several
 * means the caller holds sessions in more than one organisation and must choose (P06.07 org
 * selection), and guessing one for them would act for the wrong tenant.
 *
 * Activity recording reuses the existing `resolve_session` write path: after a successful
 * re-check the service records activity through it (capped idle slide, absolute never moves), so
 * an active session keeps its 12-hour idle contract on guarded routes exactly as on unguarded
 * ones. The write re-validates before touching state, so an expiry racing the two calls still
 * refuses rather than revives.
 *
 * Cache: read-only GETs may reuse a resolution for at most 30 seconds; every mutation
 * (POST/PUT/PATCH/DELETE and anything else) resolves fresh. A stale membership therefore costs
 * at most 30 seconds of reads, never a write. The cache is process-local, bounded
 * (MAX_CACHE_ENTRIES, oldest-evicted first), and keyed by the token digest hex: entries hold
 * identifiers and expiries only, never secrets, and eviction is by timestamp on read — no
 * timers, no sweep.
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

/**
 * Upper bound on cached resolutions. A long-lived api that never evicts except by timestamp
 * would grow one entry per distinct token; the bound keeps that a constant. Eviction is
 * insertion-ordered oldest-first — no LRU bookkeeping for a 30-second window.
 *
 * ponytail: fixed cap, not adaptive sizing; raise only if turnover evicts live entries in traces.
 */
export const MAX_CACHE_ENTRIES = 10_000;

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

  /** Cached resolutions held: the bound test asserts on this. */
  get cached(): number {
    return this.#cache.size;
  }

  /**
   * Resolve the presented token to the organisation it may act for. `mode` is `'read'` only for
   * read-only GETs (cacheable); every mutation passes `'mutate'` and hits the database. The
   * union — not a boolean — keeps a future caller from passing `true` for a write by accident.
   */
  async resolve(
    tokenHash: Buffer,
    mode: 'read' | 'mutate',
  ): Promise<{ context: SessionContext } | { failure: Exclude<ContextFailure, 'no_session'> }> {
    const useCache = mode === 'read';
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
    // Record activity through the pinned resolve_session write path (capped slide, re-validated).
    // Awaited and CHECKED: an expiry, revocation or disable racing the re-check must refuse the
    // request rather than admit-then-slide. Nothing is cached on this path.
    const slid = await this.#store.resolveSession(tokenHash);
    if (slid === undefined) return { failure: 'invalid' };
    if (useCache) {
      if (this.#cache.size >= MAX_CACHE_ENTRIES) {
        let oldest = this.#cache.keys().next();
        while (!oldest.done && this.#cache.size >= MAX_CACHE_ENTRIES) {
          this.#cache.delete(oldest.value);
          oldest = this.#cache.keys().next();
        }
      }
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
