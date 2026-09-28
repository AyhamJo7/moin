/**
 * Development seed data (P02.04.02).
 *
 * Synthetic only, always (INV-16). The demo tenants are "Musterrestaurant" (a restaurant) and
 * "Musterbetrieb SHK" (a Sanitär/Heizung/Klima trade business), because those are the two
 * verticals the pilot targets and a seed that does not look like the real thing hides real bugs:
 * German names with umlauts, five-digit PLZ, and E.164 numbers in the reserved test ranges.
 *
 * The **tenancy schema itself belongs to P06**, which owns organisations, locations and the RLS
 * framework. Until it exists this runner applies no rows and says so, rather than creating tenant
 * tables here and leaving P06 to reconcile two designs — or, worse, creating a tenant table
 * without FORCE ROW LEVEL SECURITY (INV-01).
 */

import { createPool } from './pool.ts';

export interface DemoTenant {
  readonly slug: string;
  readonly name: string;
  readonly vertical: 'restaurant' | 'handwerk-shk';
  readonly city: string;
  readonly postalCode: string;
  /** Reserved German test range (BNetzA 015 test numbers) — never routable. */
  readonly phone: string;
}

export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    slug: 'musterrestaurant',
    name: 'Musterrestaurant',
    vertical: 'restaurant',
    city: 'Hamburg',
    postalCode: '20095',
    phone: '+4915112345678',
  },
  {
    slug: 'musterbetrieb-shk',
    name: 'Musterbetrieb SHK',
    vertical: 'handwerk-shk',
    city: 'Hamburg',
    postalCode: '22765',
    phone: '+4915187654321',
  },
];

export interface SeedOutcome {
  readonly applied: number;
  readonly skipped: string[];
}

export async function seed(connectionString: string): Promise<SeedOutcome> {
  const pool = createPool({ connectionString, max: 1, application_name: 'moin-seed' });
  try {
    const tenancyExists = await hasTable(pool, 'organisations');
    if (!tenancyExists) {
      return {
        applied: 0,
        skipped: [
          'organisations: the tenancy schema is created in P06 (P06.04). The demo tenants are ' +
            'defined here and are applied as soon as that migration lands.',
        ],
      };
    }
    // P06 fills this in, inside withTenant/withSystemWork and against the real schema.
    return { applied: 0, skipped: ['tenancy schema present but seeding is implemented in P06.04'] };
  } finally {
    await pool.end();
  }
}

async function hasTable(pool: ReturnType<typeof createPool>, name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = current_schema() and table_name = $1
     ) as exists`,
    [name],
  );
  return result.rows[0]?.exists ?? false;
}
