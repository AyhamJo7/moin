/**
 * Appointment requests (P07.08.03): the machine, staff confirmation, never-a-booking.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit.ts';
import {
  confirmRequest,
  convertToBooking,
  createRequest,
  declineRequest,
  getRequest,
  listRequests,
  VersionConflictError,
} from './appointment-requests.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('appointment-requests');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

describe('appointment requests', () => {
  evidenceTest('staff confirm records who and how; stale version 409s', async () => {
    const request = await withTenant(app, ORG_A, (client) =>
      createRequest(client, {
        kind: 'appointment',
        partySize: 4,
        service: 'Abendessen',
        windowStart: new Date('2026-11-01T18:00:00Z'),
        windowEnd: new Date('2026-11-01T20:00:00Z'),
      }),
    );
    expect(request.status).toBe('open');
    const confirmed = await withTenant(app, ORG_A, (client) =>
      confirmRequest(client, request.id, {
        confirmedBy: STAFF,
        informedVia: 'call',
        version: request.version,
      }),
    );
    expect(confirmed).toMatchObject({
      status: 'confirmed_by_staff',
      confirmedBy: STAFF,
      informedVia: 'call',
    });
    await expect(
      withTenant(app, ORG_A, (client) =>
        confirmRequest(client, request.id, {
          confirmedBy: STAFF,
          informedVia: 'sms',
          version: request.version,
        }),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('decline ends open requests; confirmed or declined never move again', async () => {
    const one = await withTenant(app, ORG_A, (client) =>
      createRequest(client, { kind: 'reservation' }),
    );
    const declined = await withTenant(app, ORG_A, (client) =>
      declineRequest(client, one.id, one.version),
    );
    expect(declined.status).toBe('declined');
    await expect(
      withTenant(app, ORG_A, (client) =>
        confirmRequest(client, one.id, {
          confirmedBy: STAFF,
          informedVia: 'email',
          version: declined.version,
        }),
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
    const two = await withTenant(app, ORG_A, (client) =>
      createRequest(client, { kind: 'appointment' }),
    );
    const confirmed = await withTenant(app, ORG_A, (client) =>
      confirmRequest(client, two.id, {
        confirmedBy: STAFF,
        informedVia: 'sms',
        version: two.version,
      }),
    );
    await expect(
      withTenant(app, ORG_A, (client) => declineRequest(client, two.id, confirmed.version)),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  evidenceTest('no confirmed booking exists without staff action or tool', async () => {
    // The machine has no booked state: every row is open, confirmed_by_staff or declined.
    const request = await withTenant(app, ORG_A, (client) =>
      createRequest(client, { kind: 'appointment' }),
    );
    expect(['open', 'confirmed_by_staff', 'declined']).toContain(request.status);
    // convertToBooking records handover (P20 stub), never confirmation: status untouched.
    const handed = await withTenant(app, ORG_A, (client) =>
      convertToBooking(client, request.id, 'ext-book-1'),
    );
    expect(handed.status).toBe('open');
    expect(handed.convertedToBookingRef).toBe('ext-book-1');
    await expect(
      withTenant(app, ORG_A, (client) => convertToBooking(client, request.id, 'ext-book-2')),
    ).rejects.toBeInstanceOf(VersionConflictError);
    // DB CHECK mirrors the service: hand-written confirmation without who/how is rejected.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into appointment_requests (organisation_id, id, kind, status, confirmed_by)
           values (app.current_org(), gen_random_uuid(), 'appointment', 'confirmed_by_staff', $1)`,
          [STAFF],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  evidenceTest('invalid windows, sizes and services are refused', async () => {
    await expect(
      withTenant(app, ORG_A, (client) =>
        createRequest(client, {
          kind: 'appointment',
          windowStart: new Date('2026-11-01T20:00:00Z'),
          windowEnd: new Date('2026-11-01T18:00:00Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // The DB CHECK mirrors the service for direct SQL writers: empty and unbounded ranges
    // are rejected (23514), not just service-validated ones.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into appointment_requests (organisation_id, id, kind, "window")
           values (app.current_org(), gen_random_uuid(), 'appointment', 'empty')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into appointment_requests (organisation_id, id, kind, "window")
           values (app.current_org(), gen_random_uuid(), 'appointment',
             tstzrange('2026-11-01T18:00Z', null))`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      withTenant(app, ORG_A, (client) =>
        createRequest(client, { kind: 'appointment', partySize: 0 }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        confirmRequest(client, '00000000-0000-4000-8000-000000000000', {
          confirmedBy: 'not-a-uuid',
          informedVia: 'call',
          version: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
  });

  evidenceTest('cross-tenant requests are invisible', async () => {
    await withTenant(app, ORG_A, (client) => createRequest(client, { kind: 'appointment' }));
    const foreign = await withTenant(app, ORG_B, (client) => listRequests(client));
    expect(foreign.length).toBe(0);
    expect(await withTenant(app, ORG_A, (client) => listRequests(client))).not.toHaveLength(0);
  });

  evidenceTest('mutations audit with opaque markers, no free text', async () => {
    const request = await withTenant(app, ORG_A, (client) =>
      createRequest(client, {
        kind: 'reservation',
        service: 'Geheimservice',
        notes: 'Geheimnotiz',
      }),
    );
    await withTenant(app, ORG_A, (client) =>
      confirmRequest(client, request.id, {
        confirmedBy: STAFF,
        informedVia: 'email',
        version: request.version,
      }),
    );
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client, { targetId: request.id });
      expect(events.map((e) => e.operation).sort()).toStrictEqual([
        'request.create',
        'request.status',
      ]);
      for (const event of events) {
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheimservice');
        expect(JSON.stringify(event.args_sanitized)).not.toContain('Geheimnotiz');
      }
    });
  });

  it('reads a single request and lists by status', async () => {
    const request = await withTenant(app, ORG_B, (client) =>
      createRequest(client, { kind: 'reservation' }),
    );
    expect(await withTenant(app, ORG_B, (client) => getRequest(client, request.id))).toMatchObject({
      id: request.id,
      kind: 'reservation',
    });
    expect(
      await withTenant(app, ORG_B, (client) =>
        getRequest(client, '00000000-0000-4000-8000-000000000000'),
      ),
    ).toBeNull();
    const open = await withTenant(app, ORG_B, (client) => listRequests(client, { status: 'open' }));
    expect(open.map((r) => r.id)).toContain(request.id);
  });
});
