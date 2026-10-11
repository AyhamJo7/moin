/**
 * Business profile structured facts (P09.02, BR-064).
 *
 * One row per category per tenant: business name (+ phonetic for STT read-back),
 * address, directions, parking, services, service area (PLZ list XOR radius),
 * price ranges (EUR cents), booking/cancellation policy, escalation rules.
 *
 * Staff-direct edits with optimistic locking (expectedVersion compare-and-bump —
 * stale writers 409, same shape as setTaskStatus). Upsert by category: at most one
 * row per category, so concurrent creates race the unique and the loser re-reads
 * (SELECT-first fast path + ON CONFLICT DO NOTHING + fallback select, merge.ts
 * signal pattern).
 *
 * Validation reuses kernel value objects where they exist: PostalCode (5 digits,
 * no 00000/00xxx) for every PLZ field, Money bounds (±10M EUR whole cents) for
 * prices. Services list and body lengths are service-checked (1..50 / 1..2000).
 *
 * Answer templates (`renderAnswer`) are pure deterministic German string templates
 * — no LLM, no retrieval, no branching on content. Each category renders one fixed
 * shape from its structure. Audit carries the category marker + version only
 * (INV-12): names, addresses and prices never reach audit rows.
 */

import { randomUUID } from 'node:crypto';
import { money, postalCode } from '@moin/kernel';
import { appendAuditEvent } from './audit.ts';
import type { TenantClient } from './tenant.ts';

export class VersionConflictError extends Error {
  public override readonly name = 'VersionConflictError';
}

export type ProfileCategory =
  | 'business_name'
  | 'address'
  | 'directions'
  | 'parking'
  | 'services'
  | 'service_area'
  | 'price_ranges'
  | 'booking_policy'
  | 'cancellation_policy'
  | 'escalation_rules';

const CATEGORY_MARKER: Record<ProfileCategory, number> = {
  business_name: 0,
  address: 1,
  directions: 2,
  parking: 3,
  services: 4,
  service_area: 5,
  price_ranges: 6,
  booking_policy: 7,
  cancellation_policy: 8,
  escalation_rules: 9,
};

export interface BusinessNameFacts {
  readonly name: string;
  readonly phoneticName?: string | undefined;
}

export interface AddressFacts {
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

export interface BodyFacts {
  readonly body: string;
}

export interface ServicesFacts {
  readonly services: readonly string[];
}

export interface ServiceAreaFacts {
  readonly postcodes?: readonly string[] | undefined;
  readonly radiusKm?: number | undefined;
  readonly centerPlz?: string | undefined;
}

export interface PriceRangesFacts {
  readonly label: string;
  readonly minCents: number;
  readonly maxCents?: number | undefined;
}

export type ProfileFacts =
  | { readonly category: 'business_name'; readonly facts: BusinessNameFacts }
  | { readonly category: 'address'; readonly facts: AddressFacts }
  | {
      readonly category:
        'directions' | 'parking' | 'booking_policy' | 'cancellation_policy' | 'escalation_rules';
      readonly facts: BodyFacts;
    }
  | { readonly category: 'services'; readonly facts: ServicesFacts }
  | { readonly category: 'service_area'; readonly facts: ServiceAreaFacts }
  | { readonly category: 'price_ranges'; readonly facts: PriceRangesFacts };

export interface BusinessProfile {
  readonly id: string;
  readonly category: ProfileCategory;
  readonly version: number;
}

interface ProfileRow extends Record<string, unknown> {
  id: string;
  category: string;
  version: string;
}

function toProfile(row: ProfileRow): BusinessProfile {
  return { id: row.id, category: row.category as ProfileCategory, version: Number(row.version) };
}

function checkName(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new RangeError(`${field} must be 1..${max} characters`);
  }
  return trimmed;
}

function checkPlz(raw: string): string {
  // Kernel PostalCode: 5 digits, no 00000/00xxx. Throws RangeError otherwise.
  return postalCode(raw).value;
}

function checkCents(cents: number): number {
  // Kernel Money bounds: whole cents within ±10M EUR. Throws RangeError otherwise.
  return money(cents).cents;
}

/**
 * Upsert one category row: validates per category, then SELECT-first (fast path),
 * INSERT on miss, UPDATE with compare-and-bump when the row exists and an
 * expectedVersion is given. Concurrent creates race the unique; the loser re-reads.
 * Value params are CAST at each placeholder ($3::type) — shared $3 skeletons mistype
 * array/integer params across categories (42P08: untyped param from another leg).
 */
export async function upsertProfile(
  client: TenantClient,
  input: ProfileFacts & { expectedVersion?: number | undefined },
): Promise<BusinessProfile> {
  const built = buildColumns(input);
  const existing = await client.query<ProfileRow>(
    `select id, category, version::text from business_profile
     where organisation_id = app.current_org() and category = $1::text`,
    [input.category],
  );
  const open = existing.rows[0];
  if (open === undefined) {
    const id = randomUUID();
    const inserted = await client.query<ProfileRow>(
      // eslint-disable-next-line no-restricted-syntax -- closed-union columns/casts; values parameterised.
      `insert into business_profile (organisation_id, id, category, ${built.columns})
       values (app.current_org(), $1, $2::text, ${placeholders(built.casts, 3)})
       on conflict (organisation_id, category) do nothing
       returning id, category, version::text`,
      [id, input.category, ...built.values],
    );
    const row =
      inserted.rows[0] ??
      (
        await client.query<ProfileRow>(
          `select id, category, version::text from business_profile
           where organisation_id = app.current_org() and category = $1::text`,
          [input.category],
        )
      ).rows[0];
    if (row === undefined) throw new Error('profile upsert returned no row');
    await appendAuditEvent(client, {
      source: 'api',
      operation: 'profile.upsert',
      targetKind: 'business_profile',
      targetId: row.id,
      argsSanitized: { category: CATEGORY_MARKER[input.category], version: 1 },
      result: 'succeeded',
    });
    return toProfile(row);
  }
  // Updates REQUIRE expectedVersion: no silent unconditional path. INSERT covers
  // new categories; every UPDATE names the version it saw, else 409 — a caller that
  // forgot to read first cannot overwrite blindly.
  if (input.expectedVersion === undefined) {
    throw new VersionConflictError('business profile update requires expectedVersion');
  }
  if (Number(open.version) !== input.expectedVersion) {
    throw new VersionConflictError('business profile version mismatch');
  }
  const updated = await client.query<ProfileRow>(
    // eslint-disable-next-line no-restricted-syntax -- closed-union assignments; values parameterised.
    `update business_profile set ${assignments(built.columns, built.casts, 3)}, updated_at = clock_timestamp(),
       version = version + 1
     where organisation_id = app.current_org() and category = $1::text and version = $2::integer
     returning id, category, version::text`,
    [input.category, input.expectedVersion, ...built.values],
  );
  const row = updated.rows[0];
  if (row === undefined) throw new VersionConflictError('business profile version mismatch');
  await appendAuditEvent(client, {
    source: 'api',
    operation: 'profile.upsert',
    targetKind: 'business_profile',
    targetId: row.id,
    argsSanitized: { category: CATEGORY_MARKER[input.category], version: Number(row.version) },
    result: 'succeeded',
  });
  return toProfile(row);
}

interface BuiltColumns {
  readonly columns: string;
  readonly casts: readonly string[];
  readonly values: readonly unknown[];
}

function placeholders(casts: readonly string[], start: number): string {
  return casts.map((c, i) => `$${i + start}::${c}`).join(', ');
}

function assignments(columns: string, casts: readonly string[], start: number): string {
  return columns
    .split(', ')
    .map((col, i) => `${col} = $${i + start}::${casts[i] ?? 'text'}`)
    .join(', ');
}

function buildColumns(input: ProfileFacts): BuiltColumns {
  // Branch-per-category: column lists are union members, never interpolated from input.
  // Casts travel WITH the values (not baked into shared $3 skeletons): the caller
  // numbers placeholders per statement ($3… INSERT, $2…/$3… UPDATE), so an untyped
  // $2 category param or a NULL of unknown type can never poison inference (42P08).
  switch (input.category) {
    case 'business_name': {
      const name = checkName(input.facts.name, 'business name', 200);
      const phonetic =
        input.facts.phoneticName === undefined
          ? null
          : checkName(input.facts.phoneticName, 'phonetic name', 200);
      return {
        columns: 'name, phonetic_name',
        casts: ['text', 'text'],
        values: [name, phonetic],
      };
    }
    case 'address': {
      const street = checkName(input.facts.street, 'street', 200);
      const plz = checkPlz(input.facts.postalCode);
      const city = checkName(input.facts.city, 'city', 100);
      return {
        columns: 'street, postal_code, city',
        casts: ['text', 'text', 'text'],
        values: [street, plz, city],
      };
    }
    case 'directions':
    case 'parking':
    case 'booking_policy':
    case 'cancellation_policy':
    case 'escalation_rules': {
      const body = checkName(input.facts.body, 'body', 2000);
      return { columns: 'body', casts: ['text'], values: [body] };
    }
    case 'services': {
      const list = input.facts.services.map((s) => checkName(s, 'service', 120));
      if (list.length === 0 || list.length > 50) {
        throw new RangeError('services must be 1..50 entries');
      }
      return { columns: 'services', casts: ['text[]'], values: [list] };
    }
    case 'service_area': {
      const postcodes = input.facts.postcodes?.map((p) => checkPlz(p)) ?? null;
      const radius = input.facts.radiusKm ?? null;
      const center = input.facts.centerPlz === undefined ? null : checkPlz(input.facts.centerPlz);
      const hasList = postcodes !== null && postcodes.length > 0;
      const hasRadius = radius !== null && center !== null;
      // XOR: exactly one shape. A list AND a radius is ambiguous; neither is empty.
      if (hasList === hasRadius) {
        throw new RangeError('service area needs postcodes XOR radius+center');
      }
      if (radius !== null && (!Number.isInteger(radius) || radius < 1 || radius > 200)) {
        throw new RangeError('radius must be 1..200 km');
      }
      return {
        columns: 'area_postcodes, area_radius_km, area_center_plz',
        casts: ['text[]', 'integer', 'text'],
        values: [postcodes, radius, center],
      };
    }
    case 'price_ranges': {
      const label = checkName(input.facts.label, 'price label', 120);
      const min = checkCents(input.facts.minCents);
      const max = input.facts.maxCents === undefined ? null : checkCents(input.facts.maxCents);
      if (max !== null && max < min) throw new RangeError('price max below min');
      return {
        columns: 'price_label, price_min_cents, price_max_cents',
        casts: ['text', 'integer', 'integer'],
        values: [label, min, max],
      };
    }
  }
}

/**
 * Read one category row with its payload. Returns null when the tenant never set it.
 */
export async function getProfile(
  client: TenantClient,
  category: ProfileCategory,
): Promise<(BusinessProfile & { payload: Record<string, unknown> }) | null> {
  const found = await client.query<ProfileRow & Record<string, unknown>>(
    `select id, category, version::text, name, phonetic_name, street, postal_code, city,
       body, services, area_postcodes, area_radius_km, area_center_plz, price_label,
       price_min_cents, price_max_cents, price_currency
     from business_profile where organisation_id = app.current_org() and category = $1`,
    [category],
  );
  const row = found.rows[0];
  if (row === undefined) return null;
  const { ...payload } = row as unknown as Record<string, unknown>;
  return { ...toProfile(row), payload };
}

/**
 * Deterministic German answer template per category. Pure string templates — no LLM,
 * no retrieval, no content branching. Each category renders one fixed shape; missing
 * rows render the honest fallback (never a guess).
 */
/**
 * Deterministic German answer template per category. Pure string templates — no LLM,
 * no retrieval, no content branching. Each category renders one fixed shape.
 * Required-fields guard: a payload missing its required fields renders NULL (the
 * caller abstains — silence, never a false price like ": ab 0 Euro" from a defaulted
 * zero). Required per category: business_name→name; address→street+plz+city;
 * body categories→body; services→non-empty list; service_area→PLZ-list XOR
 * radius+center; price_ranges→label+min (max optional: single-sided "ab" when absent).
 */
export function renderAnswer(
  category: ProfileCategory,
  payload: Record<string, unknown>,
): string | null {
  const text = (key: string): string | null => {
    const value: unknown = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
    return null;
  };
  switch (category) {
    case 'business_name': {
      const name = text('name');
      if (name === null) return null;
      return `Sie haben ${name} erreicht.`;
    }
    case 'address': {
      const street = text('street');
      const plz = text('postal_code');
      const city = text('city');
      if (street === null || plz === null || city === null) return null;
      return `Unsere Adresse lautet ${street}, ${plz} ${city}.`;
    }
    case 'directions': {
      const body = text('body');
      if (body === null) return null;
      return `Anfahrt: ${body}`;
    }
    case 'parking': {
      const body = text('body');
      if (body === null) return null;
      return `Parken: ${body}`;
    }
    case 'services': {
      const raw: unknown = payload['services'];
      if (!Array.isArray(raw) || raw.length === 0) return null;
      return `Unsere Leistungen: ${raw.map((s) => String(s)).join(', ')}.`;
    }
    case 'service_area': {
      const postcodes: unknown = payload['area_postcodes'];
      if (Array.isArray(postcodes) && postcodes.length > 0) {
        return `Unser Liefergebiet umfasst die Postleitzahlen ${postcodes.map((p) => String(p)).join(', ')}.`;
      }
      const radius = text('area_radius_km');
      const center = text('area_center_plz');
      if (radius === null || center === null) return null;
      return `Wir liefern im Umkreis von ${radius} Kilometern um ${center}.`;
    }
    case 'price_ranges': {
      const label = text('price_label');
      const minRaw: unknown = payload['price_min_cents'];
      if (label === null || minRaw === null || minRaw === undefined) return null;
      const min = formatEuros(Number(minRaw));
      const maxRaw: unknown = payload['price_max_cents'];
      if (maxRaw === null || maxRaw === undefined) {
        return `${label}: ab ${min}.`;
      }
      return `${label}: ${min} bis ${formatEuros(Number(maxRaw))}.`;
    }
    case 'booking_policy': {
      const body = text('body');
      if (body === null) return null;
      return `Zur Buchung: ${body}`;
    }
    case 'cancellation_policy': {
      const body = text('body');
      if (body === null) return null;
      return `Zur Stornierung: ${body}`;
    }
    case 'escalation_rules': {
      const body = text('body');
      if (body === null) return null;
      return `In dringenden Fällen: ${body}`;
    }
  }
}

function formatEuros(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `${euros} Euro` : `${euros},${String(rest).padStart(2, '0')} Euro`;
}
