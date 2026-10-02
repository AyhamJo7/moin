/**
 * The identity-claims contract (P06.05.04): what a provider's ID token may tell us about a person.
 *
 * Authentication is the provider's; authorization is ours (ADR-0005). So the contract is
 * deliberately small. It carries exactly what the data model stores about a person and nothing
 * the provider could use to decide what that person may do:
 *
 *   - `subject` ← `sub`: the stable link to our `users` row (`users.cognito_sub`, PLAN Data
 *     Architecture). Never an email, which a person can change.
 *   - `email` ← `email`, only when `email_verified` is `true`: `users.email`, and the address an
 *     invitation is matched against (P06.08.02 requires a verified email). An unverified identity
 *     is refused here rather than carried with a flag that a later caller might forget to check.
 *
 * Keycloak (local) and Cognito (staging, production) both emit these three as standard OIDC
 * claims, so both normalise to the same identity and nothing downstream knows which one signed
 * in. Every other claim is ignored: organisation, location, role and permission claims —
 * `realm_access`, `cognito:groups`, `custom:*` or anything else — never become a trusted
 * attribute, because tenant membership and permissions are resolved server-side from our own
 * tables (INV-02, BR-109).
 *
 * The input is the payload of an ID token whose signature, issuer, audience, expiry and nonce the
 * caller has already verified (P06.06.01). This module validates its shape, not its authenticity.
 */

import { z } from 'zod';

/** RFC 5321 caps a forward path at 256 octets including the angle brackets. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Generous for an opaque identifier: both providers issue UUIDs today, but the contract does not
 * depend on that, so a provider-specific format cannot leak into it.
 */
const MAX_SUBJECT_LENGTH = 255;

/** Visible ASCII only: no whitespace or control character can make two subjects look equal. */
const SUBJECT_PATTERN = /^[\x21-\x7e]+$/;

const claimsSchema = z.object({
  sub: z.string().min(1).max(MAX_SUBJECT_LENGTH).regex(SUBJECT_PATTERN),
  email: z.email().max(MAX_EMAIL_LENGTH),
  email_verified: z.literal(true),
});

/** A person as the identity provider vouches for them, independent of which provider that is. */
export interface VerifiedIdentity {
  readonly subject: string;
  /** Lower-cased: `users.email` is `citext`, so case carries no meaning in our model. */
  readonly email: string;
}

/** Rejected claims. Names the claim and the problem, never a claim's value (INV-12). */
export class IdentityClaimsError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`identity claims rejected: ${problems.join('; ')}`);
    this.name = 'IdentityClaimsError';
    this.problems = problems;
  }
}

/** Normalise verified ID-token claims into the provider-neutral identity, or throw. */
export function parseIdentityClaims(claims: unknown): VerifiedIdentity {
  const result = claimsSchema.safeParse(claims);
  if (!result.success) {
    throw new IdentityClaimsError(
      result.error.issues.map((issue) => {
        const name = issue.path.map(String).join('.') || '(token)';
        return `${name}: ${describe(name, issue.code)}`;
      }),
    );
  }
  // Built field by field rather than returned from the parser, so that a schema change can never
  // turn an unknown provider claim into an attribute of the identity.
  return Object.freeze({
    subject: result.data.sub,
    email: result.data.email.toLowerCase(),
  });
}

/** The library's messages can quote the input; these never do. */
function describe(name: string, code: string): string {
  if (name === 'email_verified') {
    return 'must be true';
  }
  switch (code) {
    case 'invalid_type':
      return 'is missing or not the expected type';
    case 'invalid_format':
      return 'is not well-formed';
    case 'too_big':
      return 'is too long';
    default:
      return 'is not valid';
  }
}
