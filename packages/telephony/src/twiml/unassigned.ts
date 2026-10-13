/**
 * The neutral unassigned-number TwiML (P11.01.03).
 *
 * Unknown or quarantined dialled numbers never reach a tenant: the caller
 * hears one fixed German sentence and the call ends. The text names no
 * business, no tenant, no reason — a quarantined number must be
 * indistinguishable from an unknown one, or the message leaks which numbers
 * are ours.
 */

import { escapeXml } from './escape.ts';

export const UNASSIGNED_MESSAGE = 'Diese Rufnummer ist derzeit nicht vergeben.' as const;

export function buildUnassignedTwiML(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Say language="de-DE">${escapeXml(UNASSIGNED_MESSAGE)}</Say><Hangup /></Response>`
  );
}
