/**
 * Contacts and contact methods (P07.02.02, P07.02.03).
 *
 * Every method here runs inside `withTenant`: the tenant column is set by the wrapper, never by
 * the caller, and RLS narrows every statement to it. Phone/email values are normalised through
 * the kernel value objects before they reach SQL, so identity resolution (P07.03) can match on
 * exact strings. Every mutation writes an audit row in the same transaction with opaque
 * arguments only (counts and ids — no names, numbers or addresses, INV-12).
 */

import { randomUUID } from 'node:crypto';
import { emailAddress, personName, phoneNumber } from '@moin/kernel';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export type ContactMethodKind = 'phone' | 'email' | 'external_id';
export type MethodVerification = 'unverified' | 'verified' | 'suspicious' | 'withheld';

/** How control of a method value was confirmed out-of-band (P07.02 round-2). */
export type VerifiedVia =
  'owner_confirmed_call' | 'owner_confirmed_reply' | 'imported_verified' | 'migrated';

export interface Contact {
  readonly id: string;
  readonly displayName: string;
  readonly notes: string | null;
  readonly version: number;
}

export interface ContactMethod {
  readonly id: string;
  readonly contactId: string;
  readonly kind: ContactMethodKind;
  readonly value: string;
  readonly verification: MethodVerification;
  readonly verifiedVia: VerifiedVia | null;
  readonly verifiedAt: Date | null;
  readonly isTenantOwned: boolean;
  readonly version: number;
}

/** Version conflicts surface as 409 at the HTTP layer; this is the typed signal. */
export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

const METHOD_KIND_MARKER: Record<ContactMethodKind, number> = {
  phone: 0,
  email: 1,
  external_id: 2,
};

const VERIFIED_VIA_MARKER: Record<VerifiedVia, number> = {
  owner_confirmed_call: 0,
  owner_confirmed_reply: 1,
  imported_verified: 2,
  migrated: 3,
};

/** Normalise a method value to its canonical form, or throw RangeError. */
export function normaliseMethodValue(kind: ContactMethodKind, value: string): string {
  if (kind === 'phone') return phoneNumber(value).e164;
  if (kind === 'email') return emailAddress(value).value;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) throw new RangeError('external id is empty');
  return trimmed;
}

interface ContactRow extends Record<string, unknown> {
  id: string;
  display_name: string;
  notes: string | null;
  version: string;
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    displayName: row.display_name,
    notes: row.notes,
    version: Number(row.version),
  };
}

interface MethodRow extends Record<string, unknown> {
  id: string;
  contact_id: string;
  kind: string;
  value: string;
  verification: string;
  verified_via: string | null;
  verified_at: Date | null;
  is_tenant_owned: boolean;
  version: string;
}

function toMethod(row: MethodRow): ContactMethod {
  return {
    id: row.id,
    contactId: row.contact_id,
    kind: row.kind as ContactMethodKind,
    value: row.value,
    verification: row.verification as MethodVerification,
    verifiedVia: row.verified_via as VerifiedVia | null,
    verifiedAt: row.verified_at,
    isTenantOwned: row.is_tenant_owned,
    version: Number(row.version),
  };
}

export async function createContact(
  client: TenantClient,
  input: {
    displayName: string;
    notes?: string | undefined;
    methods?:
      | readonly {
          kind: ContactMethodKind;
          value: string;
          isTenantOwned?: boolean | undefined;
        }[]
      | undefined;
  },
): Promise<Contact> {
  const id = randomUUID();
  const contact = await client.query<ContactRow>(
    `insert into contacts (organisation_id, id, display_name, notes)
     values (app.current_org(), $1, $2, $3)
     returning id, display_name, notes, version::text`,
    [id, personName(input.displayName).value, input.notes ?? null],
  );
  const row = contact.rows[0];
  if (row === undefined) throw new Error('contact insert returned no row');
  let methodCount = 0;
  for (const method of input.methods ?? []) {
    await client.query(
      `insert into contact_methods
         (organisation_id, id, contact_id, kind, value, verification, is_tenant_owned)
       values (app.current_org(), $1, $2, $3, $4, 'unverified', $5)`,
      [
        randomUUID(),
        id,
        method.kind,
        normaliseMethodValue(method.kind, method.value),
        method.isTenantOwned ?? false,
      ],
    );
    methodCount += 1;
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'contact.create',
    targetKind: 'contact',
    targetId: id,
    argsSanitized: { method_count: methodCount },
    result: 'succeeded',
  });
  return toContact(row);
}

export async function updateContact(
  client: TenantClient,
  contactId: string,
  input: { displayName?: string | undefined; notes?: string | null | undefined; version: number },
): Promise<Contact> {
  const result = await client.query<ContactRow>(
    `update contacts set display_name = coalesce($2, display_name),
       notes = case when $5::boolean then null when $3::text is null then notes else $3 end,
       updated_at = clock_timestamp(), version = version + 1
     where id = $1 and version = $4
     returning id, display_name, notes, version::text`,
    [
      contactId,
      input.displayName === undefined ? null : personName(input.displayName).value,
      input.notes ?? null,
      input.version,
      input.notes === null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new VersionConflictError(`contact ${contactId} version mismatch`);
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'contact.update',
    targetKind: 'contact',
    targetId: contactId,
    argsSanitized: { version: Number(row.version) },
    result: 'succeeded',
  });
  return toContact(row);
}

export async function addContactMethod(
  client: TenantClient,
  contactId: string,
  input: {
    kind: ContactMethodKind;
    value: string;
    isTenantOwned?: boolean | undefined;
  },
): Promise<ContactMethod> {
  const id = randomUUID();
  const result = await client.query<MethodRow>(
    `insert into contact_methods
       (organisation_id, id, contact_id, kind, value, verification, is_tenant_owned)
     values (app.current_org(), $1, $2, $3, $4, 'unverified', $5)
     returning id, contact_id, kind, value, verification, verified_via, verified_at,
       is_tenant_owned, version::text`,
    [
      id,
      contactId,
      input.kind,
      normaliseMethodValue(input.kind, input.value),
      input.isTenantOwned ?? false,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('method insert returned no row');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'contact.method_add',
    targetKind: 'contact',
    targetId: contactId,
    argsSanitized: { method_kind: METHOD_KIND_MARKER[input.kind] },
    result: 'succeeded',
  });
  return toMethod(row);
}

export async function verifyContactMethod(
  client: TenantClient,
  contactId: string,
  methodId: string,
  via: VerifiedVia,
): Promise<ContactMethod> {
  // Verification is a state transition the service owns, not a flag the caller sets: only an
  // unverified method can become verified, and the unique index then enforces one owner. The
  // caller records HOW control was confirmed out-of-band; the clock stamps when.
  const result = await client.query<MethodRow>(
    `update contact_methods set verification = 'verified', verified_via = $3,
       verified_at = clock_timestamp(), updated_at = clock_timestamp(), version = version + 1
     where id = $1 and contact_id = $2 and verification = 'unverified'
     returning id, contact_id, kind, value, verification, verified_via, verified_at,
       is_tenant_owned, version::text`,
    [methodId, contactId, via],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new VersionConflictError(`method ${methodId} is not unverified`);
  }
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'contact.method_verify',
    targetKind: 'contact',
    targetId: contactId,
    argsSanitized: {
      method_kind: METHOD_KIND_MARKER[row.kind as ContactMethodKind],
      verified_via: VERIFIED_VIA_MARKER[via],
    },
    result: 'succeeded',
  });
  return toMethod(row);
}

export async function removeContactMethod(
  client: TenantClient,
  contactId: string,
  methodId: string,
): Promise<{ kind: ContactMethodKind }> {
  const removed = await client.query<{ kind: string }>(
    `delete from contact_methods where id = $1 and contact_id = $2 returning kind`,
    [methodId, contactId],
  );
  const row = removed.rows[0];
  if (row === undefined) throw new VersionConflictError(`method ${methodId} not found`);
  const kind = row.kind as ContactMethodKind;
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'contact.method_remove',
    targetKind: 'contact',
    targetId: contactId,
    argsSanitized: { method_kind: METHOD_KIND_MARKER[kind] },
    result: 'succeeded',
  });
  return { kind };
}

export async function listContacts(
  client: TenantClient,
  input: { search?: string | undefined; limit?: number | undefined } = {},
): Promise<Contact[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const result =
    input.search === undefined || input.search.trim().length === 0
      ? await client.query<ContactRow>(
          `select id, display_name, notes, version::text from contacts
           order by display_name limit $1`,
          [limit],
        )
      : await client.query<ContactRow>(
          `select c.id, c.display_name, c.notes, c.version::text from contacts c
           where c.display_name ilike $1 or exists (
             select 1 from contact_methods m
             where m.contact_id = c.id and m.organisation_id = c.organisation_id
               and m.value ilike $1
           )
           order by c.display_name limit $2`,
          [`%${input.search.trim()}%`, limit],
        );
  return result.rows.map(toContact);
}

export async function listContactMethods(
  client: TenantClient,
  contactId: string,
): Promise<ContactMethod[]> {
  const result = await client.query<MethodRow>(
    `select id, contact_id, kind, value, verification, verified_via, verified_at,
       is_tenant_owned, version::text
     from contact_methods where contact_id = $1 order by kind, value`,
    [contactId],
  );
  return result.rows.map(toMethod);
}
