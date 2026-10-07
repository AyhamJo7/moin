/**
 * Application-service authorisation checks (P06.07.02, second layer).
 *
 * Guards answer "may this role" from the membership row; services answer "may this caller touch
 * this resource in this state" — ownership and lifecycle that no static role table expresses
 * (P06.08 invitation acceptance, ownership transfer). One helper, no framework:
 * `requireCapability` re-checks the matrix in depth, so a route that forgot its `@Require`
 * still refuses in the service. Absent-or-forbidden resources return `undefined` and
 * controllers map it to 404, so cross-tenant and not-permitted resources are
 * indistinguishable (P06.07.03) — the guard already answered 403 for role failures on
 * decorated routes; 403 on existence would leak.
 */

import { type Capability, may } from '../domain/roles.ts';

/** Thrown when the caller's role lacks a capability the service requires. */
export class ForbiddenError extends Error {
  constructor(readonly capability: Capability) {
    super(`missing capability: ${capability}`);
    this.name = 'ForbiddenError';
  }
}

export function requireCapability(
  role: string,
  permissions: readonly string[],
  ...capabilities: readonly Capability[]
): void {
  for (const capability of capabilities) {
    if (!may(role, permissions, capability)) throw new ForbiddenError(capability);
  }
}
