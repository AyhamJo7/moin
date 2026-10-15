/**
 * Inbound number routing (P11.01.01/.03, INV-12).
 *
 * The dialled number (`To`) resolves to a tenant via `app.resolve_route`
 * before anything else: unknown or quarantined numbers get the neutral
 * unassigned TwiML, never another tenant. The resolver is a port so the
 * controller stays unit-testable; production binds it to the DEFINER call.
 *
 * INV-12: the dialled number is caller personal data — it never reaches logs
 * or the unassigned metric's labels. The metric counts, it does not name.
 */

import { buildUnassignedTwiML } from '@moin/telephony';

export const UNASSIGNED_NUMBER_METRIC = 'voice.unassigned_number' as const;

export interface RoutePorts {
  /** Zero rows when unknown or quarantined; exactly one row when active. */
  readonly resolveRoute: (
    e164: string,
  ) => Promise<readonly { organisationId: string; locationId: string }[]>;
  readonly countUnassigned: () => void;
}

export type InboundDecision =
  | { readonly routed: true; readonly organisationId: string; readonly locationId: string }
  | { readonly routed: false; readonly twiml: string };

/** E.164 shape check before the DB call: malformed input resolves nowhere. */
export function isRoutableE164(value: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(value);
}

export async function routeInboundCall(
  dialled: string,
  ports: RoutePorts,
): Promise<InboundDecision> {
  if (!isRoutableE164(dialled)) {
    ports.countUnassigned();
    return { routed: false, twiml: buildUnassignedTwiML() };
  }
  const rows = await ports.resolveRoute(dialled);
  const hit = rows[0];
  if (hit === undefined) {
    ports.countUnassigned();
    return { routed: false, twiml: buildUnassignedTwiML() };
  }
  return { routed: true, organisationId: hit.organisationId, locationId: hit.locationId };
}
