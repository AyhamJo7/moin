/**
 * Opening-hours engine (P09.03.04): weekly rules, exceptions, midnight spans, DST
 * transitions, Hamburg holidays, tenant isolation. Synthetic data only (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import {
  addException,
  describeWeek,
  hoursOnDate,
  isOpenAt,
  loadHours,
  nextOpening,
  setWeeklyRules,
  type HoursSnapshot,
} from './hours.ts';
import { createPool, type Pool } from './pool.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const LOC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

async function seedLocations(): Promise<void> {
  await admin.query(
    `insert into organisations (id, slug, name) values ($1, 'alpha', 'Alpha GmbH'), ($2, 'beta', 'Beta GmbH')`,
    [ORG_A, ORG_B],
  );
  await admin.query(
    `insert into locations (organisation_id, id, name) values ($1, $2, 'Mitte'), ($3, $4, 'Nord')`,
    [ORG_A, LOC_A, ORG_B, LOC_B],
  );
}

beforeAll(async () => {
  database = await createTestDatabase('hours');
  app = database.pool();
  admin = createPool({ connectionString: database.migrationUrl, max: 1 });
  await seedLocations();
});

afterAll(async () => {
  await admin.end();
  await database.drop();
});

/** Mon–Fri 09:00–18:00, no weekends. Weekdays Sunday-first: Mon=1 … Fri=5. */
async function seedWeekdays(): Promise<HoursSnapshot> {
  await withTenant(app, ORG_A, (client) =>
    setWeeklyRules(client, LOC_A, [
      { weekday: 1, opensMin: 540, closesMin: 1080 },
      { weekday: 2, opensMin: 540, closesMin: 1080 },
      { weekday: 3, opensMin: 540, closesMin: 1080 },
      { weekday: 4, opensMin: 540, closesMin: 1080 },
      { weekday: 5, opensMin: 540, closesMin: 1080 },
    ]),
  );
  return withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
}

describe('hours', () => {
  evidenceTest('weekly rules open and close at the right minutes', async () => {
    const snapshot = await seedWeekdays();
    // Wednesday 2026-10-07 10:00 Berlin (CEST, UTC+2) = 08:00Z → open.
    expect(isOpenAt(new Date('2026-10-07T08:00:00Z'), snapshot)).toBe(true);
    // Same day 19:00 Berlin = 17:00Z → closed.
    expect(isOpenAt(new Date('2026-10-07T17:00:00Z'), snapshot)).toBe(false);
    // Saturday 2026-10-10 noon → closed (no weekend rules).
    expect(isOpenAt(new Date('2026-10-10T10:00:00Z'), snapshot)).toBe(false);
    // Next opening from Saturday lands Monday 09:00 Berlin (07:00Z, CEST).
    const next = nextOpening(new Date('2026-10-10T10:00:00Z'), snapshot);
    expect(next?.toISOString()).toBe('2026-10-12T07:00:00.000Z');
  });

  evidenceTest('midnight-spanning intervals cover both days', async () => {
    // Friday 22:00–02:00 (Saturday leg 00:00–02:00).
    await withTenant(app, ORG_A, (client) =>
      setWeeklyRules(client, LOC_A, [{ weekday: 5, opensMin: 1320, closesMin: 120 }]),
    );
    const snapshot = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    // Friday 23:00 Berlin (21:00Z) → open.
    expect(isOpenAt(new Date('2026-10-09T21:00:00Z'), snapshot)).toBe(true);
    // Saturday 01:00 Berlin (Friday 23:00Z) → open via spill-over.
    expect(isOpenAt(new Date('2026-10-09T23:00:00Z'), snapshot)).toBe(true);
    // Saturday 03:00 Berlin (01:00Z) → closed.
    expect(isOpenAt(new Date('2026-10-10T01:00:00Z'), snapshot)).toBe(false);
  });

  evidenceTest('exceptions close and override; holidays need explicit rows', async () => {
    await seedWeekdays();
    // Betriebsferien: vacation range Mon–Fri 2026-11-02..06, closed all day.
    await withTenant(app, ORG_A, (client) =>
      addException(client, LOC_A, {
        kind: 'vacation',
        startDate: '2026-11-02',
        endDate: '2026-11-06',
        label: 'Betriebsferien',
      }),
    );
    const snapshot = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    // Tuesday inside the range, 10:00 Berlin (09:00Z CET) → closed.
    expect(isOpenAt(new Date('2026-11-03T09:00:00Z'), snapshot)).toBe(false);
    const day = hoursOnDate('2026-11-03', 2, snapshot, 1);
    expect(day.closed).toBe(true);
    expect(day.reason).toBe('Betriebsferien');
    // Public holiday WITHOUT an exception row keeps regular hours (explicit-only):
    // Montag 2026-10-05 is no holiday; Tag der Deutschen Einheit (Sat 2026-10-03)
    // has no Saturday rules anyway — assert the principle on a weekday holiday:
    // Reformationstag Sat 2026-10-31, no rules → closed with the holiday name.
    const sat = hoursOnDate('2026-10-31', 6, snapshot, 5);
    expect(sat.closed).toBe(true);
    expect(sat.reason).toBe('Reformationstag');
    // Holiday WITH an override row opens with override hours.
    await withTenant(app, ORG_A, (client) =>
      addException(client, LOC_A, {
        kind: 'holiday',
        startDate: '2026-12-25',
        endDate: '2026-12-25',
        opensMin: 600,
        closesMin: 720,
        label: '1. Weihnachtstag Notdienst',
      }),
    );
    const withHoliday = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    // 2026-12-25 Friday 11:00 Berlin (10:00Z CET) → open via override.
    expect(isOpenAt(new Date('2026-12-25T10:00:00Z'), withHoliday)).toBe(true);
  });

  evidenceTest('DST transitions keep wall-clock hours', async () => {
    await seedWeekdays();
    const snapshot = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    // Spring forward 2026-03-29 (CEST starts): Monday 2026-03-30 09:00 Berlin = 07:00Z.
    expect(isOpenAt(new Date('2026-03-30T07:00:00Z'), snapshot)).toBe(true);
    const next = nextOpening(new Date('2026-03-29T12:00:00Z'), snapshot);
    // Sunday → Monday 09:00 Berlin (07:00Z).
    expect(next?.toISOString()).toBe('2026-03-30T07:00:00.000Z');
    // Autumn back 2026-10-25: Monday 2026-10-26 09:00 Berlin = 08:00Z (CET).
    expect(isOpenAt(new Date('2026-10-26T08:00:00Z'), snapshot)).toBe(true);
  });

  evidenceTest('nextOpening resolves wall-clock across DST Sundays', async () => {
    await seedWeekdays();
    const snapshot = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    // Spring Sunday 2026-03-29 00:30 CET (23:30Z Saturday): minute-arithmetic would add
    // 8.5h elapsed and land 10:00 local — wall-clock resolve lands 09:00 CEST = 07:00Z.
    const spring = nextOpening(new Date('2026-03-28T23:30:00Z'), snapshot);
    expect(spring?.toISOString()).toBe('2026-03-30T07:00:00.000Z');
    // Autumn Sunday 2026-10-25 00:30 CEST (22:30Z Saturday): wall-clock resolve lands
    // Monday 09:00 CET = 08:00Z (minute math would land 08:00 local = 07:00Z).
    const autumn = nextOpening(new Date('2026-10-24T22:30:00Z'), snapshot);
    expect(autumn?.toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  evidenceTest('overnight dated exceptions cover the after-midnight leg', async () => {
    await seedWeekdays();
    // New Year's Eve special: 22:00–02:00 on 2026-12-31 (spills into 2027-01-01).
    await withTenant(app, ORG_A, (client) =>
      addException(client, LOC_A, {
        kind: 'holiday',
        startDate: '2026-12-31',
        endDate: '2026-12-31',
        opensMin: 1320,
        closesMin: 120,
        label: 'Silvester',
      }),
    );
    const snapshot = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    // 2026-12-31 23:00 Berlin (22:00Z CET) → open (today leg).
    expect(isOpenAt(new Date('2026-12-31T22:00:00Z'), snapshot)).toBe(true);
    // 2027-01-01 01:00 Berlin (00:00Z CET) → open via YESTERDAY's exception spill-over.
    expect(isOpenAt(new Date('2027-01-01T00:00:00Z'), snapshot)).toBe(true);
    // 2027-01-01 03:00 Berlin (02:00Z CET) → closed (spill leg ends 02:00).
    expect(isOpenAt(new Date('2027-01-01T02:00:00Z'), snapshot)).toBe(false);
  });

  evidenceTest('describeWeek renders deterministic German', async () => {
    await withTenant(app, ORG_A, (client) =>
      setWeeklyRules(client, LOC_A, [
        { weekday: 1, opensMin: 540, closesMin: 720 },
        { weekday: 1, opensMin: 840, closesMin: 1080 },
      ]),
    );
    const snapshot = await withTenant(app, ORG_A, (client) => loadHours(client, LOC_A));
    const text = describeWeek(new Date('2026-10-07T08:00:00Z'), snapshot);
    expect(text).toBe(
      'Mo 09:00–12:00, 14:00–18:00; Di geschlossen; Mi geschlossen; Do geschlossen; Fr geschlossen; Sa geschlossen; So geschlossen',
    );
  });

  evidenceTest('invalid intervals rejected; tenants isolated', async () => {
    await expect(
      withTenant(app, ORG_A, (client) =>
        setWeeklyRules(client, LOC_A, [{ weekday: 1, opensMin: 600, closesMin: 600 }]),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        addException(client, LOC_A, {
          kind: 'holiday',
          startDate: '2026-12-26',
          endDate: '2026-12-25',
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      withTenant(app, ORG_A, (client) =>
        addException(client, LOC_A, {
          kind: 'closure',
          startDate: '2026-12-24',
          endDate: '2026-12-24',
          opensMin: 600,
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Cross-tenant: B sees no rules; other-tenant location write dies as 23503.
    const foreign = await withTenant(app, ORG_B, (client) => loadHours(client, LOC_A));
    expect(foreign.rules).toHaveLength(0);
    await expect(
      withTenant(app, ORG_B, (client) =>
        setWeeklyRules(client, LOC_A, [{ weekday: 1, opensMin: 540, closesMin: 1080 }]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
