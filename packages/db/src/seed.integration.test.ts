/**
 * `pnpm db:seed` (ROADMAP S2) against fresh databases, as `moin_migrator` (the role `pnpm db:seed`
 * uses, subject to FORCE RLS inside each tenant).
 *
 * The expected values are written out here, not read from `DEMO_TENANTS`: a seed that swapped two
 * templates or stored the wrong hours must not agree with itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { DEMO_TENANTS, SeedRefusedError, seed, type DemoTenant } from './seed.ts';

const REALM = resolve(import.meta.dirname, '../../../docker/keycloak/realm-moin-local.json');
const databases: TestDatabase[] = [];

/** A fresh database, marked for fixture data unless `marked` is false, and its migrator URL. */
async function freshDatabase(
  name: string,
  marked = true,
): Promise<{ database: TestDatabase; url: string }> {
  const database = await createTestDatabase(name);
  databases.push(database);
  if (marked) {
    await database.fixturePool().query(
      `do $$ begin
         execute format('alter database %I set moin.fixture_data = %L', current_database(), 'allowed');
       end $$`,
    );
  }
  const base = process.env['TEST_DATABASE_MIGRATOR_URL'];
  if (base === undefined || base.length === 0) {
    throw new Error('TEST_DATABASE_MIGRATOR_URL is not set; it is in the example environment file');
  }
  const url = new URL(base);
  url.pathname = new URL(database.migrationUrl).pathname;
  return { database, url: url.toString() };
}

let main: { database: TestDatabase; url: string };

beforeAll(async () => {
  main = await freshDatabase('seed');
}, 60_000);

afterAll(async () => {
  for (const database of databases) await database.drop();
});

const EXPECTED = {
  musterrestaurant: {
    template: 'restaurant@1.0',
    // Tue to Sun 11:30 to 22:00 (Sunday is weekday 0).
    hours: [0, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_min: 690, closes_min: 1320 })),
    faqs: [
      [
        'Haben Sie einen Parkplatz?',
        'Direkt am Haus gibt es keine Parkplätze, das Parkhaus um die Ecke ist aber nah.',
      ],
      [
        'Haben Sie vegetarische Gerichte?',
        'Ja, wir haben mehrere vegetarische Gerichte auf der Karte, auch vegane.',
      ],
      ['Kann man bei Ihnen draußen sitzen?', 'Ja, bei gutem Wetter ist unsere Terrasse geöffnet.'],
    ],
    ownerEmail: 'inhaber@musterrestaurant.example',
  },
  'musterbetrieb-shk': {
    template: 'handwerk-shk@1.0',
    // Mon to Fri 07:30 to 16:30.
    hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens_min: 450, closes_min: 990 })),
    faqs: [
      [
        'Haben Sie einen Notdienst?',
        'Bei einem Rohrbruch oder Heizungsausfall rufen wir Sie so schnell wie möglich zurück.',
      ],
      ['In welchem Gebiet sind Sie unterwegs?', 'Wir arbeiten in Hamburg und im direkten Umland.'],
      [
        'Machen Sie auch Heizungswartung?',
        'Ja, wir warten Gas- und Ölheizungen und auch Wärmepumpen.',
      ],
    ],
    ownerEmail: 'mitarbeiter@musterbetrieb-shk.example',
  },
} as const;

async function persisted(database: TestDatabase, slug: string) {
  const admin = database.fixturePool();
  const one = async <T extends Record<string, unknown>>(sql: string): Promise<T[]> =>
    (await admin.query<T>(sql, [slug])).rows;
  return {
    organisations: await one('select id from organisations where slug = $1'),
    template: await one(
      `select s.template_ref from tenant_setup s join organisations o on o.id = s.organisation_id
        where o.slug = $1`,
    ),
    hours: await one(
      `select r.weekday, r.opens_min, r.closes_min from opening_rules r
         join organisations o on o.id = r.organisation_id
        where o.slug = $1 order by r.weekday`,
    ),
    faqs: (
      await one<{ canonical: string; spoken: string }>(
        `select f.canonical, f.spoken_answer as spoken from faq_cards f
           join organisations o on o.id = f.organisation_id
          where o.slug = $1 and f.active order by f.canonical`,
      )
    ).map((row) => [row.canonical, row.spoken]),
    owners: await one<{ email: string; subject: string }>(
      `select u.email::text as email, u.cognito_sub as subject from memberships m
         join users u on u.id = m.user_id
         join organisations o on o.id = m.organisation_id
        where o.slug = $1 and m.role = 'owner' and m.status = 'active'`,
    ),
    audits: await one<{
      operation: string;
      actor_id: string | null;
      correlation_id: string | null;
    }>(
      `select a.operation, a.actor_id::text, a.correlation_id::text from audit_events a
         join organisations o on o.id = a.organisation_id
        where o.slug = $1
          and a.operation in ('membership.grant', 'hours.set', 'faq.upsert', 'seed.complete')
        order by a.seq`,
    ),
  };
}

function realmSubject(email: string): string | undefined {
  const realm = JSON.parse(readFileSync(REALM, 'utf8')) as {
    users: { id?: string; email: string }[];
  };
  return realm.users.find((user) => user.email === email)?.id;
}

describe('the demo seed (S2)', () => {
  evidenceTest('stores each tenant exactly as specified', async () => {
    const first = await seed(main.url);
    expect(first.applied).toBeGreaterThan(0);
    for (const [slug, want] of Object.entries(EXPECTED)) {
      const got = await persisted(main.database, slug);
      expect(got.organisations, slug).toHaveLength(1);
      expect(got.template, slug).toStrictEqual([{ template_ref: want.template }]);
      expect(got.hours, slug).toStrictEqual(want.hours);
      expect(got.faqs, slug).toStrictEqual(want.faqs);
    }
  });

  evidenceTest('binds each owner to its subject in the local Keycloak realm', async () => {
    await seed(main.url);
    for (const [slug, want] of Object.entries(EXPECTED)) {
      const subject = realmSubject(want.ownerEmail);
      expect(subject, want.ownerEmail).toMatch(/^[0-9a-f-]{36}$/u);
      expect((await persisted(main.database, slug)).owners, slug).toStrictEqual([
        { email: want.ownerEmail, subject },
      ]);
    }
  });

  evidenceTest(
    'audits the grant and the content as one seed run, with no person as the actor',
    async () => {
      await seed(main.url);
      for (const slug of Object.keys(EXPECTED)) {
        const { audits } = await persisted(main.database, slug);
        expect(
          audits.map((row) => row.operation),
          slug,
        ).toStrictEqual([
          'membership.grant',
          'hours.set',
          'faq.upsert',
          'faq.upsert',
          'faq.upsert',
          'seed.complete',
        ]);
        expect(new Set(audits.map((row) => row.actor_id)), slug).toStrictEqual(new Set([null]));
        const runs = new Set(audits.map((row) => row.correlation_id));
        expect(runs.size, slug).toBe(1);
        expect([...runs][0], slug).toMatch(/^[0-9a-f-]{36}$/u);
      }
    },
  );

  evidenceTest('a rerun after an operator edited the seeded data changes nothing', async () => {
    await seed(main.url);
    const admin = main.database.fixturePool();
    await admin.query(
      `delete from opening_rules where organisation_id = (select id from organisations where slug = 'musterrestaurant')`,
    );
    await admin.query(
      `update faq_cards set canonical = 'Gibt es Parkplätze?'
        where canonical = 'Haben Sie einen Parkplatz?'`,
    );
    const before = await persisted(main.database, 'musterrestaurant');
    const again = await seed(main.url);
    expect(again.applied).toBe(0);
    expect(await persisted(main.database, 'musterrestaurant')).toStrictEqual(before);
  });
});

describe('the demo seed, guarded (S2)', () => {
  evidenceTest(
    'refuses a database that is not marked for fixture data and writes nothing',
    async () => {
      const unmarked = await freshDatabase('seed-unmarked', false);
      await expect(seed(unmarked.url)).rejects.toBeInstanceOf(SeedRefusedError);
      const rows = await unmarked.database
        .fixturePool()
        .query<{ n: number }>('select count(*)::int as n from organisations');
      expect(rows.rows[0]?.n).toBe(0);
    },
  );

  evidenceTest('two runs at once seed each tenant once', async () => {
    const fresh = await freshDatabase('seed-concurrent');
    await Promise.all([seed(fresh.url), seed(fresh.url)]);
    for (const [slug, want] of Object.entries(EXPECTED)) {
      const got = await persisted(fresh.database, slug);
      expect(got.hours, slug).toStrictEqual(want.hours);
      expect(got.faqs, slug).toStrictEqual(want.faqs);
      expect(got.owners, slug).toHaveLength(1);
      expect(
        got.audits.filter((row) => row.operation === 'seed.complete'),
        slug,
      ).toHaveLength(1);
    }
  });

  evidenceTest('a failure rolls the tenant back: no owner, no grant, no audit', async () => {
    const fresh = await freshDatabase('seed-rollback');
    const base = DEMO_TENANTS[0];
    if (base === undefined) throw new Error('no demo tenant');
    const broken: DemoTenant = {
      ...base,
      slug: 'kaputtbetrieb',
      name: 'Kaputtbetrieb',
      requestId: '5eed0000-0000-4000-8000-0000000000f1',
      owner: {
        id: '5eed0000-0000-4000-8000-0000000000f2',
        subject: '5eed0000-0000-4000-8000-0000000000f3',
        email: 'inhaber@kaputtbetrieb.example',
      },
      // Digit runs fail the spoken lint inside createFaqCard, after the grant was written.
      faqs: [{ canonical: 'Wie ist Ihre Nummer?', spoken: 'Rufen Sie 040 1234567 an.' }],
    };
    await expect(seed(fresh.url, [broken])).rejects.toThrow(/spoken lint/u);
    const got = await persisted(fresh.database, 'kaputtbetrieb');
    expect(got.organisations).toHaveLength(1);
    expect(got.owners).toStrictEqual([]);
    expect(got.hours).toStrictEqual([]);
    expect(got.audits).toStrictEqual([]);
    const users = await fresh.database
      .fixturePool()
      .query('select 1 from users where id = $1', [broken.owner.id]);
    expect(users.rows).toStrictEqual([]);
  });
});
