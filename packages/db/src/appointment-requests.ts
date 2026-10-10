/**
 * Appointment and reservation requests (P07.08): requests, never bookings (INV-05).
 *
 * The machine is open → confirmed_by_staff | declined. There is no booked/confirmed state on
 * purpose: confirming a booking is a commitment and commitments need a verified tool success
 * that does not exist in the pilot. `confirmRequest` records WHO on staff confirmed and HOW the
 * guest was informed (both mandatory, DB CHECK-coupled); `convertToBooking` records handover
 * to a later system via an opaque external reference — it never confirms anything itself.
 * All moves are compare-and-hold on version (VersionConflictError = 409). Every mutation audits
 * with opaque markers only (INV-12). All writes run inside `withTenant`.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type RequestKind = 'appointment' | 'reservation';
export type RequestStatus = 'open' | 'confirmed_by_staff' | 'declined';
export type InformedVia = 'call' | 'sms' | 'email' | 'in_person' | 'other';

/** Version or transition conflicts surface as 409 at the HTTP layer. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const STATUS_MARKER: Record<RequestStatus, number> = {
  open: 0,
  confirmed_by_staff: 1,
  declined: 2,
};

const KIND_MARKER: Record<RequestKind, number> = { appointment: 0, reservation: 1 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppointmentRequest {
  readonly id: string;
  readonly kind: RequestKind;
  readonly status: RequestStatus;
  readonly contactId: string | null;
  readonly conversationId: string | null;
  readonly confirmedBy: string | null;
  readonly informedVia: InformedVia | null;
  readonly partySize: number | null;
  readonly service: string | null;
  readonly convertedToBookingRef: string | null;
  readonly version: number;
}

interface RequestRow extends Record<string, unknown> {
  id: string;
  kind: string;
  status: string;
  contact_id: string | null;
  conversation_id: string | null;
  confirmed_by: string | null;
  informed_via: string | null;
  party_size: number | null;
  service: string | null;
  converted_to_booking_ref: string | null;
  version: string;
}

function toRequest(row: RequestRow): AppointmentRequest {
  return {
    id: row.id,
    kind: row.kind as RequestKind,
    status: row.status as RequestStatus,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    confirmedBy: row.confirmed_by,
    informedVia: row.informed_via as InformedVia | null,
    partySize: row.party_size,
    service: row.service,
    convertedToBookingRef: row.converted_to_booking_ref,
    version: Number(row.version),
  };
}

export interface NewRequest {
  readonly kind: RequestKind;
  readonly contactId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly windowStart?: Date | undefined;
  readonly windowEnd?: Date | undefined;
  readonly partySize?: number | undefined;
  readonly service?: string | undefined;
  readonly notes?: string | undefined;
}

export async function createRequest(
  client: TenantClient,
  input: NewRequest,
): Promise<AppointmentRequest> {
  if (input.contactId !== undefined && !UUID_RE.test(input.contactId)) {
    throw new RangeError('contact must be a contact id');
  }
  if (
    input.partySize !== undefined &&
    (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 500)
  ) {
    throw new RangeError('party size must be 1..500');
  }
  const service = input.service?.trim() ?? null;
  if (service !== null && (service.length === 0 || service.length > 120)) {
    throw new RangeError('service must be 1..120 characters');
  }
  if (
    (input.windowStart === undefined) !== (input.windowEnd === undefined) ||
    (input.windowStart !== undefined &&
      input.windowEnd !== undefined &&
      input.windowStart.getTime() >= input.windowEnd.getTime())
  ) {
    throw new RangeError('"window" needs both bounds with start before end');
  }
  const id = randomUUID();
  const result = await client.query<RequestRow>(
    `insert into appointment_requests
       (organisation_id, id, kind, contact_id, conversation_id, "window", party_size, service, notes)
     values (app.current_org(), $1, $2, $3, $4,
       case when $5::timestamptz is null then null
         else tstzrange($5::timestamptz, $6::timestamptz) end,
       $7, $8, $9)
     returning id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text`,
    [
      id,
      input.kind,
      input.contactId ?? null,
      input.conversationId ?? null,
      input.windowStart?.toISOString() ?? null,
      input.windowEnd?.toISOString() ?? null,
      input.partySize ?? null,
      service,
      input.notes ?? null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('request insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'request.create',
    targetKind: 'appointment_request',
    targetId: id,
    argsSanitized: { kind: KIND_MARKER[input.kind] },
    result: 'succeeded',
  });
  return toRequest(row);
}

/** Staff confirmation: who confirmed + how the guest was told. Both mandatory. */
export async function confirmRequest(
  client: TenantClient,
  requestId: string,
  input: { confirmedBy: string; informedVia: InformedVia; version: number },
): Promise<AppointmentRequest> {
  if (!UUID_RE.test(input.confirmedBy)) throw new RangeError('confirmed_by must be a user id');
  const moved = await client.query<RequestRow>(
    `update appointment_requests
     set status = 'confirmed_by_staff', confirmed_by = $2, informed_via = $3,
       updated_at = clock_timestamp(), version = version + 1
     where id = $1 and status = 'open' and version = $4
     returning id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text`,
    [requestId, input.confirmedBy, input.informedVia, input.version],
  );
  const row = moved.rows[0];
  if (row === undefined) {
    throw new VersionConflictError(`request ${requestId} is not open at this version`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'request.status',
    targetKind: 'appointment_request',
    targetId: requestId,
    argsSanitized: { to_status: STATUS_MARKER.confirmed_by_staff },
    result: 'succeeded',
  });
  return toRequest(row);
}

export async function declineRequest(
  client: TenantClient,
  requestId: string,
  version: number,
): Promise<AppointmentRequest> {
  const moved = await client.query<RequestRow>(
    `update appointment_requests
     set status = 'declined', updated_at = clock_timestamp(), version = version + 1
     where id = $1 and status = 'open' and version = $2
     returning id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text`,
    [requestId, version],
  );
  const row = moved.rows[0];
  if (row === undefined) {
    throw new VersionConflictError(`request ${requestId} is not open at this version`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'request.status',
    targetKind: 'appointment_request',
    targetId: requestId,
    argsSanitized: { to_status: STATUS_MARKER.declined },
    result: 'succeeded',
  });
  return toRequest(row);
}

/**
 * P20 handover stub: records the opaque external booking reference. Allowed from any status —
 * handover is orthogonal to the request lifecycle — but never twice (second call 409s) and
 * never empty. Records handover, never confirmation.
 */
export async function convertToBooking(
  client: TenantClient,
  requestId: string,
  externalRef: string,
): Promise<AppointmentRequest> {
  const ref = externalRef.trim();
  if (ref.length === 0 || ref.length > 254) throw new RangeError('external ref is empty');
  const moved = await client.query<RequestRow>(
    `update appointment_requests
     set converted_to_booking_ref = $2, updated_at = clock_timestamp(), version = version + 1
     where id = $1 and converted_to_booking_ref is null
     returning id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text`,
    [requestId, ref],
  );
  const row = moved.rows[0];
  if (row === undefined) {
    throw new VersionConflictError(`request ${requestId} already converted or missing`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'request.convert',
    targetKind: 'appointment_request',
    targetId: requestId,
    argsSanitized: { converted: 1 },
    result: 'succeeded',
  });
  return toRequest(row);
}

export async function getRequest(
  client: TenantClient,
  requestId: string,
): Promise<AppointmentRequest | null> {
  const result = await client.query<RequestRow>(
    `select id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text
     from appointment_requests where id = $1`,
    [requestId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toRequest(row);
}

export async function listRequests(
  client: TenantClient,
  input: { status?: RequestStatus | undefined; limit?: number | undefined } = {},
): Promise<AppointmentRequest[]> {
  const capped = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const result =
    input.status === undefined
      ? await client.query<RequestRow>(
          `select id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text
           from appointment_requests order by created_at limit $1`,
          [capped],
        )
      : await client.query<RequestRow>(
          `select id, kind, status, contact_id, conversation_id, confirmed_by, informed_via,
  party_size, service, converted_to_booking_ref, version::text
           from appointment_requests where status = $1 order by created_at limit $2`,
          [input.status, capped],
        );
  return result.rows.map(toRequest);
}
