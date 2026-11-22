/**
 * Development seed data (P02.04.02, ROADMAP S2).
 *
 * Synthetic only, always (INV-16). The demo tenants are "Musterrestaurant" (a restaurant) and
 * "Musterbetrieb SHK" (a Sanitär/Heizung/Klima trade business), because those are the two
 * verticals the pilot targets and a seed that does not look like the real thing hides real bugs:
 * German names with umlauts, five-digit PLZ, and E.164 numbers in the reserved test ranges.
 *
 * - **Only on a database marked for fixture data.** The local Postgres bootstrap and the test
 *   databases run `ALTER DATABASE … SET moin.fixture_data = 'allowed'`; production never does.
 *   The seed reads the marker from the catalog (`pg_db_role_setting`), not from the session, so a
 *   connection option cannot supply it. On any other database the seed refuses before its first
 *   write.
 * - **Through the production doors, in one transaction per tenant.** `app.provision_tenant` with
 *   a fixed request id creates the tenant (a rerun returns the same one), then, scoped to it
 *   (`withNewTenant`, FORCE RLS), the opening hours go through `setWeeklyRules` and the FAQ cards
 *   through `createFaqCard`. A failure rolls everything back, the tenant included.
 * - **No identities.** Provisioning records a pending owner invitation for the owner's email, a
 *   user of the local Keycloak realm. The seed creates no user and no membership: the owner joins
 *   through the invitation door at sign-in, like any owner (ROADMAP O1).
 * - **Attributed to the seed run, not to a person.** No acting user; every audit row of the run
 *   shares the run's correlation id, and `seed.complete` (source `provisioning`) closes it.
 * - **Once per tenant.** Runs take turns on provisioning's lock, and each checks for
 *   `seed.complete` first: a rerun, a concurrent run, or a run after an operator edited the
 *   seeded hours or cards changes nothing.
 *
 * It runs on the migration connection (`pnpm db:seed`): the migration role owns the tables and
 * the provisioning function, and is still subject to FORCE RLS inside each tenant.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { createFaqCard } from './faq.ts';
import { setWeeklyRules, type RuleInput } from './hours.ts';
import { createPool } from './pool.ts';
import { withNewTenant, type TenantClient } from './tenant.ts';

export interface DemoFaq {
  readonly canonical: string;
  readonly spoken: string;
}

export interface DemoTenant {
  readonly slug: string;
  readonly name: string;
  readonly vertical: 'restaurant' | 'handwerk-shk';
  readonly city: string;
  readonly postalCode: string;
  /** Reserved German test range (BNetzA 015 test numbers) — never routable. */
  readonly phone: string;
  /** Fixed, so `provision_tenant` recognises a rerun. */
  readonly requestId: string;
  readonly templateRef: string;
  /** A user of `docker/keycloak/realm-moin-local.json`; provisioning invites them as owner. */
  readonly ownerEmail: string;
  readonly hours: readonly RuleInput[];
  readonly faqs: readonly DemoFaq[];
}

const MINUTES_PER_HOUR = 60;
const at = (hour: number, minute = 0): number => hour * MINUTES_PER_HOUR + minute;

/** Sunday-first weekdays, as `opening_rules` stores them. */
const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;

export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    slug: 'musterrestaurant',
    name: 'Musterrestaurant',
    vertical: 'restaurant',
    city: 'Hamburg',
    postalCode: '20095',
    phone: '+4915112345678',
    requestId: '5eed0000-0000-4000-8000-000000000001',
    templateRef: 'restaurant@1.0',
    ownerEmail: 'inhaber@musterrestaurant.example',
    hours: [WEEKDAY.tue, WEEKDAY.wed, WEEKDAY.thu, WEEKDAY.fri, WEEKDAY.sat, WEEKDAY.sun].map(
      (weekday) => ({ weekday, opensMin: at(11, 30), closesMin: at(22) }),
    ),
    faqs: [
      {
        canonical: 'Haben Sie vegetarische Gerichte?',
        spoken: 'Ja, wir haben mehrere vegetarische Gerichte auf der Karte, auch vegane.',
      },
      {
        canonical: 'Kann man bei Ihnen draußen sitzen?',
        spoken: 'Ja, bei gutem Wetter ist unsere Terrasse geöffnet.',
      },
      {
        canonical: 'Haben Sie einen Parkplatz?',
        spoken: 'Direkt am Haus gibt es keine Parkplätze, das Parkhaus um die Ecke ist aber nah.',
      },
    ],
  },
  {
    slug: 'musterbetrieb-shk',
    name: 'Musterbetrieb SHK',
    vertical: 'handwerk-shk',
    city: 'Hamburg',
    postalCode: '22765',
    phone: '+4915187654321',
    requestId: '5eed0000-0000-4000-8000-000000000002',
    templateRef: 'handwerk-shk@1.0',
    // The local realm's one SHK user.
    ownerEmail: 'mitarbeiter@musterbetrieb-shk.example',
    hours: [WEEKDAY.mon, WEEKDAY.tue, WEEKDAY.wed, WEEKDAY.thu, WEEKDAY.fri].map((weekday) => ({
      weekday,
      opensMin: at(7, 30),
      closesMin: at(16, 30),
    })),
    faqs: [
      {
        canonical: 'Machen Sie auch Heizungswartung?',
        spoken: 'Ja, wir warten Gas- und Ölheizungen und auch Wärmepumpen.',
      },
      {
        canonical: 'Haben Sie einen Notdienst?',
        spoken:
          'Bei einem Rohrbruch oder Heizungsausfall rufen wir Sie so schnell wie möglich zurück.',
      },
      {
        canonical: 'In welchem Gebiet sind Sie unterwegs?',
        spoken: 'Wir arbeiten in Hamburg und im direkten Umland.',
      },
    ],
  },
];

export interface SeedOutcome {
  readonly applied: number;
  readonly skipped: string[];
}

/** The database setting that marks a database as one the seed may write to. */
export const FIXTURE_DATA_SETTING = 'moin.fixture_data';

export class SeedRefusedError extends Error {
  public override readonly name = 'SeedRefusedError';
}

export async function seed(
  connectionString: string,
  tenants: readonly DemoTenant[] = DEMO_TENANTS,
): Promise<SeedOutcome> {
  const pool = createPool({ connectionString, max: 1, application_name: 'moin-seed' });
  try {
    // The database-wide setting only (setrole 0): ALTER DATABASE needs the database's owner, and a
    // session or role setting proves nothing about the database.
    const marker = await pool.query(
      `select 1 from pg_db_role_setting s
         join pg_database d on d.oid = s.setdatabase
        where d.datname = current_database() and s.setrole = 0
          and $1 = any (s.setconfig)`,
      [`${FIXTURE_DATA_SETTING}=allowed`],
    );
    if (marker.rows.length === 0) {
      throw new SeedRefusedError(
        `this database is not marked for fixture data (${FIXTURE_DATA_SETTING}); nothing was written`,
      );
    }
    let applied = 0;
    for (const tenant of tenants) applied += await seedTenant(pool, tenant);
    return { applied, skipped: [] };
  } finally {
    await pool.end();
  }
}

async function seedTenant(
  pool: ReturnType<typeof createPool>,
  tenant: DemoTenant,
): Promise<number> {
  return withNewTenant(
    pool,
    async (client) => {
      // `provision_tenant` holds its advisory lock to the end of this transaction, so concurrent
      // runs take turns and a later one finds the tenant provisioned and `seed.complete` written.
      const provisioned = await client.query<{ id: string }>(
        `select app.provision_tenant($1::uuid, $2::citext, $3, $4, $5, $6) as id`,
        [
          tenant.requestId,
          tenant.slug,
          tenant.name,
          `${tenant.name} ${tenant.city}`,
          tenant.ownerEmail,
          tenant.templateRef,
        ],
      );
      const organisationId = provisioned.rows[0]?.id;
      if (organisationId === undefined) {
        throw new Error(`provisioning ${tenant.slug} returned no id`);
      }
      return organisationId;
    },
    (client) => seedInside(client, tenant),
    { correlationId: randomUUID() },
  );
}

async function seedInside(client: TenantClient, tenant: DemoTenant): Promise<number> {
  const done = await client.query(
    "select 1 from audit_events where operation = 'seed.complete' limit 1",
  );
  if (done.rows.length > 0) return 0;

  let applied = 0;
  const location = await client.query<{ id: string }>(
    'select id from locations order by created_at limit 1',
  );
  const locationId = location.rows[0]?.id;
  if (locationId === undefined) throw new Error(`${tenant.slug} has no location`);
  applied += await setWeeklyRules(client, locationId, tenant.hours);
  for (const faq of tenant.faqs) {
    await createFaqCard(client, { canonical: faq.canonical, spoken: faq.spoken });
    applied += 1;
  }
  await appendAuditEvent(client, {
    source: 'provisioning',
    operation: 'seed.complete',
    targetKind: 'organisation',
    result: 'succeeded',
  });
  return applied;
}
