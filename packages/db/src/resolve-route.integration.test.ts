/**
 * Tenant resolution for inbound voice/webhooks (P06.03.04, P11.01.01).
 *
 * `app.resolve_route(e164)` maps a dialled number to its tenant: exact match, active rows
 * only, returning exactly (organisation_id, location_id). Quarantined, released and unknown
 * numbers resolve to nothing — the voice layer answers its neutral message (P11.01.03),
 * never another tenant. Runs as the application role through the DEFINER; a direct table
 * read is revoked, so these tests prove the only reader.
 *
 * Synthetic numbers only (INV-16): +49 30 Berlin range, never real subscriber numbers.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let app: ReturnType<TestDatabase['pool']>;

let seq = 0;
function number(): string {
  seq += 1;
  return `+4930123456${String(seq).padStart(2, '0')}`;
}

beforeAll(async () => {
  database = await createTestDatabase('resolve-route');
  admin = database.fixturePool();
  app = database.pool();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

async function org(slug: string): Promise<{ org: string; location: string }> {
  const orgId = randomUUID();
  const locationId = randomUUID();
  await admin.query('insert into organisations (id, slug, name) values ($1, $2, $3)', [
    orgId,
    slug,
    'Route Org',
  ]);
  await admin.query('insert into locations (organisation_id, id, name) values ($1, $2, $3)', [
    orgId,
    locationId,
    'Standort',
  ]);
  return { org: orgId, location: locationId };
}

async function route(
  e164: string,
  orgId: string,
  locationId: string,
  status = 'active',
): Promise<void> {
  await admin.query(
    'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
    [e164, orgId, locationId, status],
  );
}

async function resolve(e164: string): Promise<{ org: string; location: string }[]> {
  const rows = await app.query<{ organisation_id: string; location_id: string }>(
    'select * from app.resolve_route($1::text)',
    [e164],
  );
  return rows.rows.map((row) => ({ org: row.organisation_id, location: row.location_id }));
}

describe('resolve_route (P06.03.04)', () => {
  evidenceTest('an active number resolves to its organisation and location', async () => {
    const { org: orgId, location } = await org(`r-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await route(e164, orgId, location);
    expect(await resolve(e164)).toStrictEqual([{ org: orgId, location }]);
  });

  evidenceTest('quarantined, released and unknown numbers resolve to nothing', async () => {
    const { org: orgId, location } = await org(`q-${randomUUID().slice(0, 8)}`);
    const quarantined = number();
    const released = number();
    const unknown = number();
    await route(quarantined, orgId, location, 'quarantined');
    await route(released, orgId, location, 'released');
    expect(await resolve(quarantined)).toStrictEqual([]);
    expect(await resolve(released)).toStrictEqual([]);
    expect(await resolve(unknown)).toStrictEqual([]);
  });

  evidenceTest('two tenants resolve their own numbers, never each other’s', async () => {
    const a = await org(`a-${randomUUID().slice(0, 8)}`);
    const b = await org(`b-${randomUUID().slice(0, 8)}`);
    const numA = number();
    const numB = number();
    await route(numA, a.org, a.location);
    await route(numB, b.org, b.location);
    expect(await resolve(numA)).toStrictEqual([{ org: a.org, location: a.location }]);
    expect(await resolve(numB)).toStrictEqual([{ org: b.org, location: b.location }]);
  });

  evidenceTest('resolution needs no tenant context (global by design)', async () => {
    const { org: orgId, location } = await org(`g-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await route(e164, orgId, location);
    // No withTenant anywhere in this file: the voice adapter resolves before any
    // session exists. Globality is the design (global-tables.md rule 3), and this
    // pins it — a future RLS policy on number_routes would break this test loudly
    // instead of silently dropping every inbound call.
    expect(await resolve(e164)).toStrictEqual([{ org: orgId, location }]);
  });

  evidenceTest('a cross-tenant location pointer is unrepresentable', async () => {
    const a = await org(`x-${randomUUID().slice(0, 8)}`);
    const b = await org(`y-${randomUUID().slice(0, 8)}`);
    await expect(route(number(), a.org, b.location)).rejects.toMatchObject({ code: '23503' });
  });

  evidenceTest('a malformed number is rejected at the table', async () => {
    const { org: orgId, location } = await org(`m-${randomUUID().slice(0, 8)}`);
    await expect(route('0049301234', orgId, location)).rejects.toMatchObject({ code: '23514' });
    await expect(route('+49', orgId, location)).rejects.toMatchObject({ code: '23514' });
  });
});
