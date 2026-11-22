/**
 * Development seed data (P02.04.02, ROADMAP S2).
 *
 * Synthetic only, always (INV-16). The demo tenants are "Musterrestaurant" (a restaurant) and
 * "Musterbetrieb SHK" (a Sanitär/Heizung/Klima trade business), because those are the two
 * verticals the pilot targets and a seed that does not look like the real thing hides real bugs:
 * German names with umlauts, five-digit PLZ, and E.164 numbers in the reserved test ranges.
 *
 * - **Only on a database marked for fixture data.** The local Postgres bootstrap and the test
 *   databases set `moin.fixture_data = 'allowed'`; production never does. On any other database
 *   the seed refuses before its first write.
 * - **Through the production doors.** Each tenant comes from `app.provision_tenant` with a fixed
 *   request id, so a rerun returns the same tenant. Everything else for that tenant runs in one
 *   transaction inside it (`withTenant`, FORCE RLS): the owner (a user bound to the local Keycloak
 *   realm's fixed subject, and an active owner membership with a `membership.grant` audit event),
 *   the opening hours through `setWeeklyRules` and the FAQ cards through `createFaqCard`.
 * - **Attributed to the seed run, not to a person.** No acting user; every audit row of the run
 *   shares the run's correlation id, and `seed.complete` (source `provisioning`) closes it.
 * - **Once per tenant.** The transaction holds a per-tenant advisory lock and checks for
 *   `seed.complete` first: a rerun, a concurrent run, or a run after an operator edited the
 *   seeded hours or cards changes nothing. A failure rolls the whole tenant back.
 *
 * It runs on the migration connection (`pnpm db:seed`): the migration role owns the tables and
 * the provisioning function, and is still subject to FORCE RLS inside each tenant.
 */

import { randomUUID } from 'node:crypto';
import { appendAuditEvent } from './audit.ts';
import { createFaqCard } from './faq.ts';
import { setWeeklyRules, type RuleInput } from './hours.ts';
import { createPool } from './pool.ts';
import { withTenant, type TenantClient } from './tenant.ts';

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
  /** `subject` is the user's fixed id in `docker/keycloak/realm-moin-local.json`. */
  readonly owner: { readonly id: string; readonly subject: string; readonly email: string };
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
    owner: {
      id: '5eed0000-0000-4000-8000-0000000000a1',
      subject: '5eed0000-0000-4000-8000-0000000000c1',
      email: 'inhaber@musterrestaurant.example',
    },
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
    owner: {
      id: '5eed0000-0000-4000-8000-0000000000b1',
      // The local realm's one SHK user.
      subject: '5eed0000-0000-4000-8000-0000000000c2',
      email: 'mitarbeiter@musterbetrieb-shk.example',
    },
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
    const marker = await pool.query<{ value: string | null }>(
      'select current_setting($1, true) as value',
      [FIXTURE_DATA_SETTING],
    );
    if (marker.rows[0]?.value !== 'allowed') {
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
  const provisioned = await pool.query<{ id: string }>(
    `select app.provision_tenant($1::uuid, $2::citext, $3, $4, $5, $6) as id`,
    [
      tenant.requestId,
      tenant.slug,
      tenant.name,
      `${tenant.name} ${tenant.city}`,
      tenant.owner.email,
      tenant.templateRef,
    ],
  );
  const organisationId = provisioned.rows[0]?.id;
  if (organisationId === undefined) throw new Error(`provisioning ${tenant.slug} returned no id`);
  return withTenant(pool, organisationId, (client) => seedInside(client, tenant), {
    correlationId: randomUUID(),
  });
}

async function seedInside(client: TenantClient, tenant: DemoTenant): Promise<number> {
  // One seed run per tenant at a time; the first one to finish marks the tenant done.
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [`seed:${tenant.requestId}`]);
  const done = await client.query(
    "select 1 from audit_events where operation = 'seed.complete' limit 1",
  );
  if (done.rows.length > 0) return 0;

  const user = await client.query(
    `insert into users (id, cognito_sub, email, status) values ($1, $2, $3, 'active')
     on conflict (id) do nothing`,
    [tenant.owner.id, tenant.owner.subject, tenant.owner.email],
  );
  let applied = user.rowCount ?? 0;
  const membershipId = randomUUID();
  const membership = await client.query(
    `insert into memberships (organisation_id, id, user_id, role, status)
     values (app.current_org(), $1, $2, 'owner', 'active')
     on conflict (organisation_id, user_id) do nothing`,
    [membershipId, tenant.owner.id],
  );
  if ((membership.rowCount ?? 0) > 0) {
    applied += 1;
    await appendAuditEvent(client, {
      source: 'provisioning',
      operation: 'membership.grant',
      targetKind: 'membership',
      targetId: membershipId,
      result: 'succeeded',
    });
  }
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
