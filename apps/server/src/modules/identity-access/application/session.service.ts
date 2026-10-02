/**
 * The session primitives (P06.06.02): resolve, rotate, revoke.
 *
 * Everything here starts from the raw token a browser presented and immediately reduces it to its
 * digest; a value that is not shaped like a token we issued is refused unread. The rules — valid
 * means unrevoked, inside 12 hours of activity and 7 days of sign-in, for an active user; rotation
 * revokes the predecessor and keeps its absolute expiry; revocation is final — live in the database
 * functions, so this layer cannot weaken them.
 *
 * `rotate` is the primitive P06.06.04 (step-up) and P06.07 (privilege change) call after their own
 * checks. Nothing in this change calls it for those reasons yet; sign-in has its own path, which
 * always issues a fresh token.
 */

import { uuidv7, type Clock } from '@moin/kernel';
import type { IdentityStore, ResolvedSession, SessionGrant } from '@moin/db';
import type { RotationReason } from '../domain/session-policy.ts';
import { digestOf, isSecretValue, randomSecret } from '../domain/secret-values.ts';

export interface RotatedSession {
  /** The successor's raw token, for the cookie and nowhere else. */
  readonly sessionToken: string;
  readonly grant: SessionGrant;
}

export class SessionService {
  readonly #store: IdentityStore;
  readonly #clock: Clock;

  constructor(store: IdentityStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  async resolve(presented: string | undefined): Promise<ResolvedSession | undefined> {
    if (!isSecretValue(presented)) return undefined;
    return this.#store.resolveSession(digestOf(presented), this.#clock.now());
  }

  async rotate(
    presented: string | undefined,
    reason: RotationReason,
  ): Promise<RotatedSession | undefined> {
    if (!isSecretValue(presented)) return undefined;
    const sessionToken = randomSecret();
    const now = this.#clock.now();
    const grant = await this.#store.rotateSession(
      digestOf(presented),
      digestOf(sessionToken),
      uuidv7({ now: () => now }),
      reason,
      now,
    );
    return grant === undefined ? undefined : { sessionToken, grant };
  }

  async revoke(presented: string | undefined): Promise<boolean> {
    if (!isSecretValue(presented)) return false;
    return this.#store.revokeSession(digestOf(presented), this.#clock.now());
  }
}
