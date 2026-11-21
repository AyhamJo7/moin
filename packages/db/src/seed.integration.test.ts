/**
 * `pnpm db:seed` (ROADMAP S2): the demo tenants, each with an owner, opening hours and owner-written
 * FAQ cards, through `provision_tenant` and the product services. Run twice on a fresh database as
 * `moin_migrator` (the role `pnpm db:seed` uses, subject to FORCE RLS inside each tenant): the
 * second run applies nothing and every count stays.
 */
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { DEMO_TENANTS, seed } from './seed.ts';

let database: TestDatabase;
let migratorUrl: string;

beforeAll(async () => {
  database = await createTestDatabase('seed');
  const base = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (base === undefined || base.length === 0) {
    throw new Error('TEST_DATABASE_MIGRATOR_URL is not set; it is in the example environment file');
  }
  const url = new URL(base);
  url.pathname = new URL(database.migrationUrl).pathname;
  migratorUrl = url.toString();
}, 60_000);

afterAll(async () => {
  await database.drop();
});

interface Counts {
  readonly organisations: number;
  readonly locations: number;
  readonly owners: number;
  readonly hours: number;
  readonly faqs: number;
  readonly audited: number;
}

async function counts(slug: string): Promise<Counts> {
  const result = await database.fixturePool().query<Counts>(
    `select
       (select count(*)::int from organisations o where o.slug = $1) as organisations,
       (select count(*)::int from locations l join organisations o on o.id = l.organisation_id
         where o.slug = $1) as locations,
       (select count(*)::int from memberships m join organisations o on o.id = m.organisation_id
         where o.slug = $1 and m.role = 'owner' and m.status = 'active') as owners,
       (select count(*)::int from opening_rules r join organisations o on o.id = r.organisation_id
         where o.slug = $1) as hours,
       (select count(*)::int from faq_cards f join organisations o on o.id = f.organisation_id
         where o.slug = $1 and f.active) as faqs,
       (select count(*)::int from audit_events a join organisations o on o.id = a.organisation_id
         where o.slug = $1 and a.operation in ('hours.set', 'faq.upsert')) as audited`,
    [slug],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('no counts');
  return row;
}

describe('the demo seed (S2)', () => {
  evidenceTest('creates each demo tenant once, and a second run applies nothing', async () => {
    const first = await seed(migratorUrl);
    expect(first.applied).toBeGreaterThan(0);
    const expected = new Map(
      DEMO_TENANTS.map((tenant) => [
        tenant.slug,
        {
          organisations: 1,
          locations: 1,
          owners: 1,
          hours: tenant.hours.length,
          faqs: tenant.faqs.length,
          // One audit row for the hours, one per card, all with the owner as the actor.
          audited: 1 + tenant.faqs.length,
        },
      ]),
    );
    for (const [slug, want] of expected) expect(await counts(slug), slug).toStrictEqual(want);

    const second = await seed(migratorUrl);
    expect(second.applied).toBe(0);
    for (const [slug, want] of expected) expect(await counts(slug), slug).toStrictEqual(want);
  });

  evidenceTest('the owner is the acting user of every seeded audit row', async () => {
    await seed(migratorUrl);
    for (const tenant of DEMO_TENANTS) {
      const actors = await database.fixturePool().query<{ actor_id: string | null }>(
        `select distinct a.actor_id::text from audit_events a
           join organisations o on o.id = a.organisation_id
          where o.slug = $1 and a.operation in ('hours.set', 'faq.upsert')`,
        [tenant.slug],
      );
      expect(actors.rows).toStrictEqual([{ actor_id: tenant.owner.id }]);
    }
  });
});
