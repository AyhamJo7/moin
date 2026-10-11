/**
 * Business profile structured facts (P09.02.04): per-category validation, German
 * templates for every category, optimistic locking, tenant isolation.
 * Synthetic data only (INV-16).
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { listAuditEvents } from './audit.ts';
import { createPool, type Pool } from './pool.ts';
import {
  getProfile,
  renderAnswer,
  upsertProfile,
  VersionConflictError as ProfileConflict,
} from './profile.ts';
import { withTenant } from './tenant.ts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let database: TestDatabase;
let app: Pool;
let admin: Pool;

beforeAll(async () => {
  database = await createTestDatabase('profile');
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

describe('profile', () => {
  evidenceTest('every category renders correct German', async () => {
    const cases = [
      {
        input: {
          category: 'business_name' as const,
          facts: { name: 'Bäckerei Schmidt', phoneticName: 'Bäckerei Schmidt' },
        },
        german: 'Sie haben Bäckerei Schmidt erreicht.',
      },
      {
        input: {
          category: 'address' as const,
          facts: { street: 'Hauptstraße 12', postalCode: '20354', city: 'Hamburg' },
        },
        german: 'Unsere Adresse lautet Hauptstraße 12, 20354 Hamburg.',
      },
      {
        input: {
          category: 'directions' as const,
          facts: { body: 'Ab Hauptbahnhof mit der U3 bis Baumwall.' },
        },
        german: 'Anfahrt: Ab Hauptbahnhof mit der U3 bis Baumwall.',
      },
      {
        input: {
          category: 'parking' as const,
          facts: { body: 'Parkhaus nebenan, erste Stunde frei.' },
        },
        german: 'Parken: Parkhaus nebenan, erste Stunde frei.',
      },
      {
        input: {
          category: 'services' as const,
          facts: { services: ['Haarschnitt', 'Färbung'] },
        },
        german: 'Unsere Leistungen: Haarschnitt, Färbung.',
      },
      {
        input: {
          category: 'service_area' as const,
          facts: { postcodes: ['20354', '20355'] },
        },
        german: 'Unser Liefergebiet umfasst die Postleitzahlen 20354, 20355.',
      },
      {
        input: {
          category: 'service_area' as const,
          facts: { radiusKm: 15, centerPlz: '20354' },
        },
        german: 'Wir liefern im Umkreis von 15 Kilometern um 20354.',
      },
      {
        input: {
          category: 'price_ranges' as const,
          facts: { label: 'Haarschnitt', minCents: 2500, maxCents: 4500 },
        },
        german: 'Haarschnitt: 25 Euro bis 45 Euro.',
      },
      {
        input: {
          category: 'price_ranges' as const,
          facts: { label: 'Anfahrt', minCents: 590 },
        },
        german: 'Anfahrt: ab 5,90 Euro.',
      },
      {
        input: {
          category: 'booking_policy' as const,
          facts: { body: 'Bitte einen Tag vorher anrufen.' },
        },
        german: 'Zur Buchung: Bitte einen Tag vorher anrufen.',
      },
      {
        input: {
          category: 'cancellation_policy' as const,
          facts: { body: 'Bis 24 Stunden vorher kostenfrei.' },
        },
        german: 'Zur Stornierung: Bis 24 Stunden vorher kostenfrei.',
      },
      {
        input: {
          category: 'escalation_rules' as const,
          facts: { body: 'Bei Notfällen die Chefin rufen.' },
        },
        german: 'In dringenden Fällen: Bei Notfällen die Chefin rufen.',
      },
    ];
    for (const { input, german } of cases) {
      // Re-runnable: a repeat category UPDATES — read its version first (updates
      // require expectedVersion since round-1: no silent unconditional path).
      const prior = await withTenant(app, ORG_A, (client) => getProfile(client, input.category));
      const written = await withTenant(app, ORG_A, (client) =>
        upsertProfile(
          client,
          prior === null ? input : { ...input, expectedVersion: prior.version },
        ),
      );
      expect(written.category).toBe(input.category);
      const stored = await withTenant(app, ORG_A, (client) => getProfile(client, input.category));
      expect(stored).not.toBeNull();
      expect(renderAnswer(input.category, stored?.payload ?? {})).toBe(german);
    }
  });

  evidenceTest('invalid data rejected per category, never stored', async () => {
    // Bad PLZ (kernel: 00000 refused).
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, {
          category: 'address',
          facts: { street: 'Hauptstraße 1', postalCode: '00000', city: 'Hamburg' },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Empty services list.
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, { category: 'services', facts: { services: [] } }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Both PLZ list AND radius: ambiguous XOR.
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, {
          category: 'service_area',
          facts: { postcodes: ['20354'], radiusKm: 10, centerPlz: '20354' },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Neither shape: empty.
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, { category: 'service_area', facts: {} }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Radius without center.
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, { category: 'service_area', facts: { radiusKm: 10 } }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Price max below min.
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, {
          category: 'price_ranges',
          facts: { label: 'X', minCents: 5000, maxCents: 1000 },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Non-integer cents (kernel Money: whole cents).
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, {
          category: 'price_ranges',
          facts: { label: 'X', minCents: 10.5 },
        }),
      ),
    ).rejects.toBeInstanceOf(RangeError);
    // Nothing stored by the rejected writes: the render test wrote service_area
    // twice (PLZ list, then radius) — the LAST render write wins, so the radius
    // shape survives; the rejected XOR/empty writes never overwrote it. price_ranges
    // likewise still holds the render-test label.
    const area = await withTenant(app, ORG_A, (client) => getProfile(client, 'service_area'));
    expect(area?.payload['area_radius_km']).toBe(15);
    expect(area?.payload['area_center_plz']).toBe('20354');
    const prices = await withTenant(app, ORG_A, (client) => getProfile(client, 'price_ranges'));
    expect(prices?.payload['price_label']).toBe('Anfahrt');
  });

  evidenceTest('concurrent edits 409 on stale version; audit markers only', async () => {
    // NOTE the render-every-category test above already wrote parking v1 in this
    // per-file database — read its version and bump from there instead of assuming 1.
    const prior = await withTenant(app, ORG_A, (client) => getProfile(client, 'parking'));
    expect(prior).not.toBeNull();
    const base = prior?.version ?? 1;
    // Stale expectedVersion 409s.
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, {
          category: 'parking',
          facts: { body: 'Hofplatz zwei.' },
          expectedVersion: 999,
        }),
      ),
    ).rejects.toBeInstanceOf(ProfileConflict);
    // Fresh write bumps (version required — unconditional updates are refused).
    const second = await withTenant(app, ORG_A, (client) =>
      upsertProfile(client, {
        category: 'parking',
        facts: { body: 'Hofplatz zwei.' },
        expectedVersion: base,
      }),
    );
    expect(second.version).toBe(base + 1);
    // Update WITHOUT expectedVersion 409s (no silent unconditional path).
    await expect(
      withTenant(app, ORG_A, (client) =>
        upsertProfile(client, {
          category: 'parking',
          facts: { body: 'Hofplatz drei.' },
        }),
      ),
    ).rejects.toBeInstanceOf(ProfileConflict);
    // Audit carries category + version markers — never names, addresses or prices.
    await withTenant(app, ORG_A, async (client) => {
      const events = await listAuditEvents(client);
      const profiles = events.filter((e) => e.operation === 'profile.upsert');
      expect(profiles.length).toBeGreaterThan(0);
      for (const event of profiles) {
        const raw = JSON.stringify(event.args_sanitized);
        expect(raw).not.toContain('Hofplatz');
        expect(raw).not.toContain('Bäckerei');
        expect(event.args_sanitized).toHaveProperty('category');
      }
    });
  });

  evidenceTest('missing fields abstain: renderAnswer returns null, never a false price', () => {
    expect(renderAnswer('price_ranges', {})).toBeNull();
    expect(renderAnswer('price_ranges', { price_max_cents: 4500 })).toBeNull();
    expect(renderAnswer('business_name', {})).toBeNull();
    expect(renderAnswer('service_area', {})).toBeNull();
    expect(renderAnswer('services', { services: [] })).toBeNull();
  });

  evidenceTest('DB boundary rejects 00000, shapeless service_area via direct SQL', async () => {
    // 00000 address: kernel shape refused at service AND CHECK at DB.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into business_profile (organisation_id, id, category, street, postal_code, city)
           values (app.current_org(), gen_random_uuid(), 'address', 'Hauptstraße 1', '00000', 'Hamburg')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // service_area neither shape: XOR CHECK refuses.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into business_profile (organisation_id, id, category)
           values (app.current_org(), gen_random_uuid(), 'service_area')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // service_area both shapes: XOR CHECK refuses.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into business_profile
             (organisation_id, id, category, area_postcodes, area_radius_km, area_center_plz)
           values (app.current_org(), gen_random_uuid(), 'service_area', '{20354}', 10, '20354')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // 00xxx inside the PLZ array: element CHECK refuses.
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into business_profile (organisation_id, id, category, area_postcodes)
           values (app.current_org(), gen_random_uuid(), 'service_area', '{00123}')`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // NULL element inside the PLZ array: three-valued logic would pass NOT EXISTS
    // without the explicit NULL arm — the renderer would emit a literal "null".
    await expect(
      withTenant(app, ORG_A, (client) =>
        client.query(
          `insert into business_profile (organisation_id, id, category, area_postcodes)
           values (app.current_org(), gen_random_uuid(), 'service_area', array['20354', NULL])`,
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  evidenceTest('tenants isolated per category', async () => {
    const prior = await withTenant(app, ORG_A, (client) => getProfile(client, 'business_name'));
    await withTenant(app, ORG_A, (client) =>
      upsertProfile(
        client,
        prior === null
          ? { category: 'business_name', facts: { name: 'Alpha Laden' } }
          : {
              category: 'business_name',
              facts: { name: 'Alpha Laden' },
              expectedVersion: prior.version,
            },
      ),
    );
    const foreign = await withTenant(app, ORG_B, (client) => getProfile(client, 'business_name'));
    expect(foreign).toBeNull();
    const other = await withTenant(app, ORG_B, (client) =>
      upsertProfile(client, {
        category: 'business_name',
        facts: { name: 'Beta Laden' },
      }),
    );
    expect(other.version).toBe(1);
    const kept = await withTenant(app, ORG_A, (client) => getProfile(client, 'business_name'));
    expect(renderAnswer('business_name', kept?.payload ?? {})).toBe(
      'Sie haben Alpha Laden erreicht.',
    );
  });
});
