/**
 * Contact erasure and anonymisation (P16.05.02/.04): verified erasure shapes —
 * anonymised markers replace name/phone, the audit skeleton (ids, timestamps)
 * is kept, and the deletion record closes the request. Pure; the pipeline
 * and handlers ride separately.
 */

/** Anonymised marker replacing erased identity fields. */
export const ERASED_MARKER = 'gelöscht';

export interface ErasureRequest {
  readonly contactId: string;
  readonly identityVerified: boolean;
}

export interface ErasedContact {
  readonly contactId: string;
  readonly displayName: string;
  readonly phone: string;
  readonly skeletonKept: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** True when erasure may proceed: valid id + verified identity. */
export function erasureAllowed(request: ErasureRequest): boolean {
  return UUID_RE.test(request.contactId) && request.identityVerified;
}

/** Anonymise the contact: markers replace identity, skeleton kept. */
export function anonymiseContact(contactId: string): ErasedContact {
  if (!UUID_RE.test(contactId)) throw new RangeError('contact id must be a uuid');
  return { contactId, displayName: ERASED_MARKER, phone: ERASED_MARKER, skeletonKept: true };
}

/** Deletion record line for the ledger (id only, never the values). */
export function erasureRecord(contactId: string): string {
  if (!UUID_RE.test(contactId)) throw new RangeError('contact id must be a uuid');
  return `erased ${contactId}`;
}
