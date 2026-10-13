/**
 * Voice-layer routing against resolve_route (P11.01.04): active routes
 * through, quarantined resolve to the neutral message, and a released
 * (DELETEd) number stops routing. Fresh DB per run, synthetic numbers.
 */
import { randomUUID } from 'node:crypto';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, vi } from 'vitest';
import { routeInboundCall } from './inbound-route.ts';

let database: TestDatabase;
let admin: ReturnType<TestDatabase['fixturePool']>;
let app: ReturnType<TestDatabase['pool']>;

let seq = 100;
function number(): string {
  seq += 1;
  return `+4930987654${String(seq).padStart(2, '0')}`;
}

beforeAll(async () => {
  database = await createTestDatabase('inbound-route');
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

function ports() {
  return {
    resolveRoute: (e164: string) =>
      app
        .query<{ organisation_id: string; location_id: string }>(
          'select * from app.resolve_route($1::text)',
          [e164],
        )
        .then((r) =>
          r.rows.map((row) => ({ organisationId: row.organisation_id, locationId: row.location_id })),
        ),
    countUnassigned: vi.fn(),
  };
}

describe('voice-layer routing (P11.01.04)', () => {
  evidenceTest('active routes resolve; quarantined get the neutral message', async () => {
    const { org: orgId, location } = await org(`v-${randomUUID().slice(0, 8)}`);
    const active = number();
    const held = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [active, orgId, location, 'active'],
    );
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [held, orgId, location, 'quarantined'],
    );
    const p = ports();
    expect(await routeInboundCall(active, p)).toStrictEqual({
      routed: true,
      organisationId: orgId,
      locationId: location,
    });
    const quarantined = await routeInboundCall(held, p);
    expect(quarantined).toMatchObject({ routed: false });
    if (!quarantined.routed) {
      expect(quarantined.twiml).toContain('Diese Rufnummer ist derzeit nicht vergeben.');
    }
    expect(p.countUnassigned).toHaveBeenCalledOnce();
  });

  evidenceTest('cache invalidation on config change re-resolves routing', async () => {
    const { org: orgId, location } = await org(`c-${randomUUID().slice(0, 8)}`);
    const e164 = number();
    await admin.query(
      'insert into number_routes (e164, route_organisation_id, location_id, status) values ($1, $2, $3, $4)',
      [e164, orgId, location, 'active'],
    );
    const p = ports();
    expect((await routeInboundCall(e164, p)).routed).toBe(true);
    // Release: DELETE frees the number; the same E.164 stops routing.
    await admin.query('delete from number_routes where e164 = $1', [e164]);
    const after = await routeInboundCall(e164, p);
    expect(after).toMatchObject({ routed: false });
    expect(p.countUnassigned).toHaveBeenCalledOnce();
  });
});
