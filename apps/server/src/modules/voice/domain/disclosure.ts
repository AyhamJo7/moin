/**
 * The AI disclosure spoken before every session (INV-03).
 *
 * ## Status of this wording
 *
 * **Not legally approved.** `docs/legal-briefs/03-disclosure-and-scripts.md` is the question put to
 * external counsel (EXT-02) and it has not been answered. This constant is the engineering
 * placeholder that lets the feasibility calls happen; the pilot does not run on it.
 *
 * What the wording has to do is fixed even if the words are not:
 *
 *   - say that the caller is speaking to an AI assistant, in plain German, first;
 *   - say who is responsible — the business, not us;
 *   - say that the call is not recorded as audio (INV-07), because that is the question people
 *     actually ask, and answering it before they ask shortens the call;
 *   - offer the way to a human, because a disclosure that traps someone is worse than none.
 *
 * It is a constant rather than tenant configuration on purpose. A tenant who can edit the
 * disclosure can delete it, and INV-03 would then hold only for tenants who left the default.
 * The business name is the one variable part.
 */

export const DISCLOSURE_STATUS = 'PROPOSED — pending EXT-02 (external counsel)' as const;

/** Builds the disclosure for a business. The name is the only tenant-controlled part. */
export function buildDisclosure(businessName: string): string {
  const name = businessName.trim();
  if (name === '') {
    throw new Error('the disclosure needs the business name it is spoken on behalf of');
  }
  return (
    `Guten Tag, Sie sprechen mit dem digitalen Assistenten von ${name}. ` +
    'Ich bin ein KI-Assistent und kein Mensch. ' +
    'Das Gespräch wird nicht als Audio aufgezeichnet. ' +
    'Wenn Sie lieber mit einer Person sprechen möchten, sagen Sie einfach "Mitarbeiter".'
  );
}

/** The business the feasibility calls are made on behalf of, until a tenant registry exists (P06). */
export const FEASIBILITY_BUSINESS_NAME = 'dem Testanschluss';
