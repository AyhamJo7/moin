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
 * Activity is recorded by the DEFINER call itself (capped slide folded in): validity, write
 * and memberships share one `v_now`, so no expiry can lapse between a read and a separate
 * write. An active session keeps its 12-hour idle contract on guarded routes exactly as on
 * unguarded ones.
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
  /** Last MFA proof; null until re-verified. Sensitive actions judge it (P06.06.04). */
  readonly stepUpAt: Date | null;
  /** Freshness judged by the database clock against the 15-minute window (P06.06.04). */
  readonly stepUpFresh: boolean;
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

function monotonicMs(clock: Clock): number {
  if (typeof clock.monotonicMs === 'function') {
    return clock.monotonicMs();
  }
  return performance.now();
}

interface CachedEntry {
  readonly maxLifetimeMs: number;
  readonly expiresAtMs: number;
  readonly idleExpiresAtMs: number;
  readonly absoluteExpiresAtMs: number;
  /**
   * Remaining step-up budget in ms, computed entirely on the database clock at insert
   * (Defect 2). The hit check spends it in local monotonic elapsed time, so constant app↔DB
   * skew can neither stretch nor shrink the verdict, and backward wall-clock adjustments
   * cannot extend it. Entries are never cached unstamped.
   */
  readonly stepUpBudgetMs: number;
  readonly cachedAtMonotonicMs: number;
  readonly cachedAtWallMs: number;
  lastSeenWallMs: number;
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
    stepUpAt: context.stepUpAt,
    stepUpFresh: context.stepUpFresh,
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
    const nowMs = this.#clock.now().getTime();
    const nowMonoMs = monotonicMs(this.#clock);
    if (!useCache) {
      // A mutation just changed what a cached read would serve (disable, role change,
      // revocation): drop the entry so the next GET re-resolves instead of serving up to 30 s
      // of pre-mutation context. Reads keep the PLAN-allowed staleness ceiling.
      this.#cache.delete(key);
    }
    if (useCache) {
      const hit = this.#cache.get(key);
      if (hit !== undefined) {
        const wallMovedBack = nowMs < hit.lastSeenWallMs || nowMs < hit.cachedAtWallMs;
        const wallExpired =
          nowMs >= hit.expiresAtMs ||
          nowMs >= hit.idleExpiresAtMs ||
          nowMs >= hit.absoluteExpiresAtMs;
        const monoElapsed = nowMonoMs - hit.cachedAtMonotonicMs;
        const monoExpired = monoElapsed >= hit.maxLifetimeMs;

        if (wallMovedBack || wallExpired || monoExpired) {
          this.#cache.delete(key);
        } else {
          hit.lastSeenWallMs = nowMs;
          if (monoElapsed >= hit.stepUpBudgetMs) {
            return { context: { ...hit.context, stepUpFresh: false } };
          }
          return { context: hit.context };
        }
      }
    }
    this.#lookups += 1;
    // Single DEFINER call: validity, memberships and the capped activity slide share one v_now.
    const resolved = await this.#store.resolveRequestContext(tokenHash);
    if (resolved === undefined) return { failure: 'invalid' };
    const context = toSessionContext(resolved);
    if (context === undefined) return { failure: 'ambiguous_organisation' };
    // An unstamped session carries no step-up deadline to bound a cache entry — so it is
    // never cached: every read re-resolves rather than serving a verdict with no expiry.
    // The budget comes from the database verdict (seconds remaining on the DB clock), not
    // from comparing the DB stamp against the app clock — so skew shifts nothing.
    if (useCache && resolved.stepUpAt !== null && resolved.stepUpRemainingSeconds !== null) {
      const stepUpBudgetMs = Math.max(0, resolved.stepUpRemainingSeconds * 1000);
      const idleRemainingMs = Math.max(0, resolved.idleRemainingSeconds * 1000);
      const absoluteRemainingMs = Math.max(0, resolved.absoluteRemainingSeconds * 1000);
      const maxLifetimeMs = Math.min(CONTEXT_CACHE_TTL_MS, idleRemainingMs, absoluteRemainingMs);

      if (maxLifetimeMs > 0) {
        if (this.#cache.size >= MAX_CACHE_ENTRIES) {
          let oldest = this.#cache.keys().next();
          while (!oldest.done && this.#cache.size >= MAX_CACHE_ENTRIES) {
            this.#cache.delete(oldest.value);
            oldest = this.#cache.keys().next();
          }
        }
        this.#cache.set(key, {
          maxLifetimeMs,
          expiresAtMs: nowMs + maxLifetimeMs,
          idleExpiresAtMs: nowMs + idleRemainingMs,
          absoluteExpiresAtMs: nowMs + absoluteRemainingMs,
          stepUpBudgetMs,
          cachedAtMonotonicMs: nowMonoMs,
          cachedAtWallMs: nowMs,
          lastSeenWallMs: nowMs,
          context,
        });
      }
    }
    return { context };
  }

  /** Drop cached entries; used by tests to prove expiry without waiting 30 real seconds. */
  clearCache(): void {
    this.#cache.clear();
  }
}
