/**
 * A generic seeder for every tenant table, read from the live catalog (P06.02.06, P06.13.01).
 *
 * Shared by the cross-tenant write matrix (`packages/db`) and the cross-tenant suite's two-tenant
 * world (`apps/server` xsuite): both need one row of each tenant in every table that has an
 * `organisation_id` column, and a table added by a later migration must be seeded the day it
 * exists. Every function takes the migration-role fixture pool (stage setup, never behaviour).
 * Synthetic data only (INV-16).
 */
import type { Pool } from '@moin/db/pool';

/**
 * Tenant tables that a generic seeder cannot fill. Each still gets the checks that need no seed
 * row (no context reads nothing, a foreign INSERT is refused, an UPDATE moving the tenant touches
 * no row); what it misses is a seeded row of B to prove untouched. The reason says why and where
 * the table's seeded proof lives instead.
 */
export const UNSEEDABLE: Readonly<Record<string, string>> = {
  audit_events:
    'ENABLE ALWAYS triggers refuse any row not appended through app.append_audit_event; seeded isolation is proven by the audit suites and the xsuite DB-layer test',
};

/**
 * Values a CHECK constraint needs that its literals do not name (a pattern, a relation between two
 * columns, an exactly-one-of rule). Keyed by table, then column; a column listed here is added to
 * the row even when it is nullable. Replication mode switches foreign keys off for the seed, so a
 * random uuid is a sufficient parent reference. Each entry cites the constraint it satisfies.
 */
const SEED_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // domain ~ '^[a-z0-9]…(\.[a-z0-9]…)+$'
  business_domains: { domain: `'d' || substr(md5(random()::text), 1, 10) || '.example'` },
  // category-specific required field (business_name needs name)
  business_profile: { category: `'business_name'`, name: `'Muster'` },
  // request_hash ~ '^[0-9a-f]{64}$'
  callback_acceptances: { request_hash: `encode(sha256(random()::text::bytea), 'hex')` },
  // expires_at within one second of created_at + 7 days; token_hash is a 32-byte digest
  invitations: {
    expires_at: `now() + interval '7 days'`,
    token_hash: `sha256(random()::text::bytea)`,
  },
  // num_nonnulls(item_id, card_id) = 1
  knowledge_reverify_queue: { item_id: 'gen_random_uuid()' },
  // exactly one of contact_id, task_id, lead_id
  notes: { contact_id: 'gen_random_uuid()' },
  // opens_min <> closes_min
  opening_rules: { opens_min: '480', closes_min: '1020' },
  // ends_at > starts_at
  slot_holds: { starts_at: 'now()', ends_at: `now() + interval '1 hour'` },
  // template_ref ~ '^[a-z][a-z0-9_-]{0,63}@[0-9]+[.][0-9]+$'
  tenant_setup: { template_ref: `'template@1.0'` },
  // exactly one of ai_action_id, actor_user_id
  tool_invocations: { actor_user_id: 'gen_random_uuid()' },
};

export interface TenantTable {
  readonly qualified: string;
  readonly name: string;
  /**
   * The column a write must name to choose the tenant: `organisation_id`, or for a table that
   * derives it (`organisations`, whose `organisation_id` is generated from `id`) the source column.
   */
  readonly tenantColumn: string;
  readonly columns: readonly Column[];
}

export interface Column {
  readonly name: string;
  readonly type: string;
  readonly typeCategory: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  readonly identity: boolean;
  readonly enumLabel: string | null;
  readonly vectorDimensions: number | null;
}

/** Every table with an organisation_id column, in every non-system schema, from the catalog. */
export async function liveTenantTables(pool: Pool): Promise<TenantTable[]> {
  const tables = await pool.query<{
    qualified: string;
    name: string;
    oid: number;
  }>(
    `SELECT c.oid::int AS oid, c.oid::regclass::text AS qualified, c.relname::text AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\\_toast%'
       AND EXISTS (SELECT 1 FROM pg_attribute o
                   WHERE o.attrelid = c.oid AND o.attname = 'organisation_id' AND NOT o.attisdropped)
     ORDER BY 2`,
  );
  const result: TenantTable[] = [];
  for (const table of tables.rows) {
    const columns = await pool.query<{
      name: string;
      type: string;
      type_category: string;
      not_null: boolean;
      has_default: boolean;
      identity: boolean;
      enum_label: string | null;
      vector_dimensions: number | null;
    }>(
      `SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type,
              t.typcategory::text AS type_category, a.attnotnull AS not_null, a.atthasdef AS has_default, (a.attidentity <> '') AS identity,
              (SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid = a.atttypid ORDER BY e.enumsortorder LIMIT 1) AS enum_label,
              CASE WHEN t.typname = 'vector' THEN a.atttypmod END AS vector_dimensions
       FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
       WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
       ORDER BY a.attnum`,
      [table.oid],
    );
    const generation = await pool.query<{ expression: string }>(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
       FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = $1 AND a.attname = 'organisation_id' AND a.attgenerated <> ''`,
      [table.oid],
    );
    const derived = generation.rows[0]?.expression.replace(/[()"\s]/g, '');
    result.push({
      qualified: table.qualified,
      name: table.name,
      tenantColumn:
        derived !== undefined && /^[a-z_]+$/u.test(derived) ? derived : 'organisation_id',
      columns: columns.rows.map((c) => ({
        name: c.name,
        type: c.type,
        typeCategory: c.type_category,
        notNull: c.not_null,
        hasDefault: c.has_default,
        identity: c.identity,
        enumLabel: c.enum_label,
        vectorDimensions: c.vector_dimensions,
      })),
    });
  }
  return result;
}

/** A SQL literal expression for one required column; undefined when the type has no generic value. */
function valueFor(column: Column, org: string, tenantColumn: string): string | undefined {
  if (column.name === tenantColumn) return `'${org}'::uuid`;
  if (column.enumLabel !== null) return `'${column.enumLabel}'::${column.type}`;
  const type = column.type;
  if (type === 'uuid') return 'gen_random_uuid()';
  if (type === 'text' || type === 'citext' || type.startsWith('character'))
    return `'m' || substr(md5(random()::text), 1, 12)`;
  if (type === 'integer' || type === 'smallint' || type === 'bigint') return '1';
  if (type.startsWith('numeric') || type === 'real' || type === 'double precision') return '1';
  if (type === 'boolean') return 'false';
  if (type.startsWith('timestamp')) return 'now()';
  if (type === 'date') return 'current_date';
  if (type.startsWith('time')) return `'12:00'`;
  if (type === 'interval') return `'1 day'`;
  if (type === 'jsonb' || type === 'json') return `'{}'::jsonb`;
  if (type === 'bytea') return `decode(md5(random()::text), 'hex')`;
  if (type === 'inet') return `'10.0.0.1'`;
  if (type.endsWith('[]')) return `'{}'`;
  if (column.vectorDimensions !== null)
    return `array_fill(0, ARRAY[${String(column.vectorDimensions)}])::vector`;
  return undefined;
}

/** Column → SQL expression for one seeded row of `org`, or the reason a column has no generic value. */
function seedValues(table: TenantTable, org: string): Map<string, string> | { reason: string } {
  const values = new Map<string, string>();
  for (const column of table.columns) {
    if (!column.notNull && column.name !== table.tenantColumn) continue;
    if ((column.hasDefault || column.identity) && column.name !== table.tenantColumn) continue;
    const value = valueFor(column, org, table.tenantColumn);
    if (value === undefined)
      return { reason: `no generic value for ${column.name} ${column.type}` };
    values.set(column.name, value);
  }
  for (const [name, expression] of Object.entries(SEED_OVERRIDES[table.name] ?? {})) {
    values.set(name, expression);
  }
  return values;
}

function insertSql(table: TenantTable, values: ReadonlyMap<string, string>): string {
  const names = [...values.keys()].map((name) => `"${name}"`).join(', ');
  // eslint-disable-next-line no-restricted-syntax -- identifiers come from pg_catalog, never from input.
  return `INSERT INTO ${table.qualified} (${names}) VALUES (${[...values.values()].join(', ')})`;
}

const QUOTED = /'((?:[^']|'')*)'/gu;

/**
 * Seeds one row for `org` as the owner, with triggers and foreign-key checks off. A CHECK
 * constraint that rejects the generic value names the literals it accepts; the column it binds
 * takes each in turn, so the seeder follows the schema instead of copying it.
 */
export async function seedTenantRow(
  pool: Pool,
  table: TenantTable,
  org: string,
): Promise<string | undefined> {
  // `organisations` is the tenant itself: the two test tenants are its rows already.
  if (table.tenantColumn !== 'organisation_id' && (await countTenantRows(pool, table, org)) > 0) {
    return undefined;
  }
  const values = seedValues(table, org);
  if ('reason' in values) return values.reason;
  const tried = new Map<string, Set<string>>();
  const client = await pool.connect();
  try {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL session_replication_role = replica`);
        await client.query(insertSql(table, values));
        await client.query('COMMIT');
        return undefined;
      } catch (error) {
        await client.query('ROLLBACK');
        const failure = error as { code?: string; constraint?: string; message?: string };
        if (failure.code !== '23514' || failure.constraint === undefined) {
          return failure.message ?? String(error);
        }
        const definition = await pool.query<{ def: string; columns: string[] }>(
          `SELECT pg_get_constraintdef(con.oid) AS def,
                  ARRAY(SELECT a.attname::text FROM unnest(con.conkey) k
                        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k) AS columns
           FROM pg_constraint con WHERE con.conrelid = $1::regclass AND con.conname = $2`,
          [table.qualified, failure.constraint],
        );
        const row = definition.rows[0];
        if (row === undefined) return failure.message ?? String(error);
        const literals = [...row.def.matchAll(QUOTED)].map((m) => m[1] ?? '');
        let changed = false;
        for (const name of row.columns) {
          const column = table.columns.find((c) => c.name === name);
          const textLike =
            column !== undefined &&
            (column.enumLabel !== null ||
              column.type === 'text' ||
              column.type === 'citext' ||
              column.type.startsWith('character'));
          if (
            column === undefined ||
            !textLike ||
            !values.has(name) ||
            name === table.tenantColumn ||
            SEED_OVERRIDES[table.name]?.[name] !== undefined
          ) {
            continue;
          }
          const done = tried.get(name) ?? new Set<string>();
          tried.set(name, done);
          const next = literals.find((literal) => !done.has(literal));
          if (next === undefined) continue;
          done.add(next);
          values.set(name, `'${next}'::${column.enumLabel !== null ? column.type : 'text'}`);
          changed = true;
          break;
        }
        if (!changed) return failure.message ?? String(error);
      }
    }
    return 'check constraints not satisfied after 24 attempts';
  } finally {
    client.release();
  }
}

export async function countTenantRows(
  pool: Pool,
  table: TenantTable,
  org: string,
): Promise<number> {
  const sql = `SELECT count(*)::int AS n FROM ${table.qualified} WHERE ${table.tenantColumn} = $1`; // eslint-disable-line no-restricted-syntax -- identifiers from pg_catalog, never input.
  const res = await pool.query<{ n: number }>(sql, [org]);
  return res.rows[0]?.n ?? 0;
}

/**
 * The drift check: tenant tables in which one of `orgs` has no row. Empty means every tenant table
 * is seeded for every given tenant; a table added without a seed shows up here by name.
 */
export async function unseededTenantTables(pool: Pool, orgs: readonly string[]): Promise<string[]> {
  const unseeded: string[] = [];
  for (const table of await liveTenantTables(pool)) {
    for (const org of orgs) {
      if ((await countTenantRows(pool, table, org)) === 0) unseeded.push(`${table.name} (${org})`);
    }
  }
  return unseeded;
}
