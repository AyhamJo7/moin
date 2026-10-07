/**
 * The session primitives (P06.06.02): resolve, rotate, revoke.
 *
 * Everything here starts from the raw token a browser presented and immediately reduces it to its
 * digest; a value that is not shaped like a token we issued is refused unread. The rules — valid
 * means unrevoked, inside 12 hours of activity and 7 days of sign-in, for an active user; rotation
 * revokes the predecessor and keeps its absolute expiry; revocation is final — live in the database
 * functions, so this layer cannot weaken them.
 *
 * `rotate` handles privilege-change rotation after its caller's checks. Step-up rotation belongs
 * only in `SignInService.#completeStepUp`, after verified provider proof and subject binding;
 * this primitive cannot express an unproven step-up.
 */

import { uuidv7, type Clock } from '@moin/kernel';
import type { IdentityStore, ResetReason, ResolvedSession, SessionGrant } from '@moin/db';
import { digestOf, isSecretValue, randomSecret } from '../domain/secret-values.ts';

export interface RotatedSession {
  /** The successor's raw token, for the cookie and nowhere else. */
  readonly sessionToken: string;
  readonly grant: SessionGrant;
}

export class SessionService {
  readonly #store: IdentityStore;
  /**
   * Identifier clock only: mints `uuidv7` timestamps for the successor token id. Never a
   * security clock — session validity is judged by the database clock inside the functions.
   */
  readonly #idClock: Clock;

  constructor(store: IdentityStore, idClock: Clock) {
    this.#store = store;
    this.#idClock = idClock;
  }

  async resolve(presented: string | undefined): Promise<ResolvedSession | undefined> {
    if (!isSecretValue(presented)) return undefined;
    return this.#store.resolveSession(digestOf(presented));
  }

  async rotate(presented: string | undefined): Promise<RotatedSession | undefined> {
    if (!isSecretValue(presented)) return undefined;
    const sessionToken = randomSecret();
    const now = this.#idClock.now();
    const grant = await this.#store.rotateSession(
      digestOf(presented),
      digestOf(sessionToken),
      uuidv7({ now: () => now }),
      'privilege_change',
    );
    return grant === undefined ? undefined : { sessionToken, grant };
  }

  async revoke(presented: string | undefined): Promise<boolean> {
    if (!isSecretValue(presented)) return false;
    return this.#store.revokeSession(digestOf(presented));
  }

  /**
   * "Sign out other devices" (P06.06.05): every other live session of the presented session's
   * owner ends, the presented one stays. The owner is whoever the presented session belongs to —
   * there is no user id parameter to forge. Undefined when the cookie is not a valid session now.
   */
  async revokeOthers(presented: string | undefined): Promise<number | undefined> {
    if (!isSecretValue(presented)) return undefined;
    return this.#store.revokeOtherSessions(digestOf(presented));
  }

  /**
   * Every session of a person ends after a password or MFA reset (P06.06.05). The provider-event
   * and support flows of P06.09 are the callers; they establish that the reset happened.
   */
  revokeAll(userId: string, reason: ResetReason): Promise<number> {
    return this.#store.revokeAllSessions(userId, reason);
  }
}
