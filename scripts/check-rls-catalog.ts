/**
 * The catalog check (P06.02.04, INV-01, INV-02).
 *
 * ## Why this reads the catalog rather than the migrations
 *
 * Every other guard in this repository is static: lint rules, boundary rules, reference checks.
 * This one is not, and it is the most important of them, because the question it answers cannot
 * be answered from source. A migration can apply a policy and a later migration can drop it; a
 * table can be created by a hotfix; `ALTER TABLE … DISABLE ROW LEVEL SECURITY` is one line and
 * leaves no trace in a diff anyone would read carefully. What protects tenant data is the state
 * of `pg_catalog` in the database that is actually running, so that is what this reads.
 *
 * ## What it asserts, and why each one
 *
 * 1. **Every table with an `organisation_id` column has RLS enabled *and* forced.** Enabled
 *    without forced is the failure that looks fine: the policy applies to everyone except the
 *    table's owner, and the owner is who runs migrations, backfills and admin connections.
 * 2. **Its policy covers every command.** A policy with `USING` and no `WITH CHECK` reads
 *    correctly and permits writing a row into another tenant.
 * 3. **`UNIQUE (organisation_id, id)`**, because a child's composite foreign key has nothing to
 *    reference without it.
 * 4. **Every foreign key out of a tenant table is composite**, carrying `organisation_id`. RLS
 *    stops a query returning another tenant's row; this stops a row *pointing* at one.
 * 5. **No runtime role can bypass RLS.** A role with `BYPASSRLS` or `SUPERUSER` makes every
 *    policy above decorative.
 * 6. **Every `SECURITY DEFINER` function is on the allowlist and pins `search_path`.** These are
 *    the only sanctioned way across a tenant boundary. An unpinned `search_path` on one of them
 *    is a privilege-escalation primitive: the caller chooses which `public.foo()` it calls.
 * 7. **A table with no `organisation_id` is on the global register**, with a reason. Otherwise
 *    "not a tenant table" and "somebody forgot the column" look identical.
 *
 *   node scripts/check-rls-catalog.ts              # uses DATABASE_URL
 *   node scripts/check-rls-catalog.ts --url <url>
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createPool } from '@moin/db/pool';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBAL_REGISTER = join(REPO_ROOT, 'docs', 'architecture', 'global-tables.md');
const DEFINER_ALLOWLIST = join(REPO_ROOT, 'docs', 'architecture', 'security-definer-allowlist.md');

/** Roles that serve traffic. None of them may ever see past a policy. */
const RUNTIME_ROLES = [
  'moin_app',
  'moin_provisioner',
  'moin_dispatcher',
  'moin_support_ro',
  'moin_reporting',
];

export interface Finding {
  readonly rule: string;
  readonly subject: string;
  readonly detail: string;
}

interface TableRow {
  readonly table_name: string;
  readonly has_org_column: boolean;
  readonly rls_enabled: boolean;
  readonly rls_forced: boolean;
  readonly policy_count: number;
  readonly commands: string[];
  readonly policies_without_check: string[];
  readonly has_composite_unique: boolean;
}

interface ForeignKeyRow {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly columns: string[];
  readonly target_table: string;
}

interface FunctionRow {
  readonly function_name: string;
  readonly identity_arguments: string;
  readonly owner_name: string;
  readonly search_path: string | null;
  readonly execute_grantees: string[];
}

/** Reviewed QG-09 contract. Documentation registration alone cannot change privileges. */
const APPROVED_DEFINERS: Readonly<
  Record<
    string,
    {
      readonly arguments: string;
      readonly owners: readonly string[];
      readonly searchPath: string;
      readonly executeGrantees: readonly string[];
    }
  >
> = {
  'app.provision_tenant': {
    arguments: 'uuid, citext, text, text, text, text, text, boolean, text',
    // The migrator owns the test function. Owner is also allowed for deployments using SET ROLE.
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_provisioner'],
  },
  'app.append_audit_event': {
    arguments: 'uuid, uuid, text, text, text, uuid, jsonb, jsonb, jsonb, text, uuid, uuid, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
};

interface RoleRow {
  readonly rolname: string;
  readonly rolbypassrls: boolean;
  readonly rolsuper: boolean;
}

/** Table names listed, with a reason, in the global-table register. */
export function registeredGlobalTables(path: string = GLOBAL_REGISTER): Set<string> {
  const text = readFileSync(path, 'utf8');
  const names = new Set<string>();
  for (const match of text.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
    const name = match[1];
    const reason = (match[2] ?? '').trim();
    // A row with no reason is not a justification, and this register exists to carry the reason.
    if (name !== undefined && reason.length > 0 && reason !== '—') {
      names.add(name);
    }
  }
  return names;
}

/** Function names on the reviewed SECURITY DEFINER allowlist. */
export function allowlistedDefiners(path: string = DEFINER_ALLOWLIST): Set<string> {
  const text = readFileSync(path, 'utf8');
  const names = new Set<string>();
  for (const match of text.matchAll(/^\|\s*`([a-z0-9_.]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
    const name = match[1];
    const reason = (match[2] ?? '').trim();
    if (name !== undefined && reason.length > 0 && reason !== '—') {
      names.add(name);
    }
  }
  return names;
}

const TABLE_QUERY = `
  SELECT c.relname::text AS table_name,
         EXISTS (
           SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'organisation_id' AND NOT a.attisdropped
         ) AS has_org_column,
         c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policy_count,
         COALESCE((SELECT array_agg(DISTINCT p.polcmd::text) FROM pg_policy p WHERE p.polrelid = c.oid), '{}') AS commands,
         COALESCE((
           SELECT array_agg(p.polname::text ORDER BY p.polname)
           FROM pg_policy p
           WHERE p.polrelid = c.oid AND p.polcmd IN ('*', 'a', 'w') AND p.polwithcheck IS NULL
         ), '{}') AS policies_without_check,
         EXISTS (
           SELECT 1 FROM pg_constraint u
           WHERE u.conrelid = c.oid AND u.contype IN ('u', 'p')
             AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
                  FROM unnest(u.conkey) k JOIN pg_attribute att
                    ON att.attrelid = c.oid AND att.attnum = k)
                 = ARRAY['id', 'organisation_id']
         ) AS has_composite_unique
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' AND n.nspname = 'public'
  ORDER BY c.relname
`;

const FK_QUERY = `
  SELECT c.relname::text AS table_name,
         con.conname::text AS constraint_name,
         (SELECT array_agg(att.attname::text ORDER BY att.attname)
          FROM unnest(con.conkey) k JOIN pg_attribute att
            ON att.attrelid = c.oid AND att.attnum = k) AS columns,
         t.relname::text AS target_table
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_class t ON t.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE con.contype = 'f' AND n.nspname = 'public'
`;

const FUNCTION_QUERY = `
  SELECT (n.nspname || '.' || p.proname)::text AS function_name,
         oidvectortypes(p.proargtypes)::text AS identity_arguments,
         pg_get_userbyid(p.proowner)::text AS owner_name,
         (SELECT s FROM unnest(COALESCE(p.proconfig, '{}')) s WHERE s LIKE 'search_path=%') AS search_path,
         COALESCE((SELECT array_agg((CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text ORDER BY a.grantee)
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
           WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner), ARRAY[]::text[]) AS execute_grantees
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef AND n.nspname IN ('public', 'app')
`;

const ROLE_QUERY = `SELECT rolname::text, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ANY($1)`;

export async function inspect(
  url: string,
  allowlistPath: string = DEFINER_ALLOWLIST,
): Promise<Finding[]> {
  const pool = createPool({ connectionString: url, max: 1 });
  const findings: Finding[] = [];
  try {
    const globals = registeredGlobalTables();
    const definers = allowlistedDefiners(allowlistPath);

    const tables = (await pool.query<TableRow>(TABLE_QUERY)).rows;
    for (const table of tables) {
      if (!table.has_org_column) {
        if (!globals.has(table.table_name)) {
          findings.push({
            rule: 'unregistered-global-table',
            subject: table.table_name,
            detail:
              'has no organisation_id and is not in docs/architecture/global-tables.md. ' +
              '"Deliberately global" and "somebody forgot the column" must not look the same.',
          });
        }
        continue;
      }

      if (!table.rls_enabled) {
        findings.push({
          rule: 'rls-not-enabled',
          subject: table.table_name,
          detail:
            'has organisation_id but no row-level security. Every row is visible to every tenant.',
        });
      }
      if (!table.rls_forced) {
        findings.push({
          rule: 'rls-not-forced',
          subject: table.table_name,
          detail:
            'row-level security is enabled but not FORCEd, so it does not apply to the table owner — ' +
            'who runs migrations, backfills and admin connections.',
        });
      }
      if (table.policy_count === 0) {
        findings.push({
          rule: 'no-policy',
          subject: table.table_name,
          detail:
            'row-level security is on with no policy, which denies everything and will be "fixed" by disabling it.',
        });
      } else if (!table.commands.includes('*')) {
        const missing = ['r', 'a', 'w', 'd'].filter((cmd) => !table.commands.includes(cmd));
        if (missing.length > 0) {
          findings.push({
            rule: 'policy-missing-commands',
            subject: table.table_name,
            detail: `no policy covers ${missing.join(', ')} (r=select a=insert w=update d=delete).`,
          });
        }
      }
      if (table.policies_without_check.length > 0) {
        findings.push({
          rule: 'policy-without-with-check',
          subject: table.table_name,
          detail:
            `policy ${table.policies_without_check.join(', ')} permits writes with no WITH CHECK, ` +
            'so a row can be written into another tenant.',
        });
      }
      if (!table.has_composite_unique) {
        findings.push({
          rule: 'no-composite-unique',
          subject: table.table_name,
          detail:
            'has no UNIQUE (organisation_id, id); a child table has nothing to reference compositely.',
        });
      }
    }

    const tenantTables = new Set(tables.filter((t) => t.has_org_column).map((t) => t.table_name));
    for (const fk of (await pool.query<ForeignKeyRow>(FK_QUERY)).rows) {
      if (!tenantTables.has(fk.table_name) || !tenantTables.has(fk.target_table)) {
        continue;
      }
      // A foreign key whose target is `organisations` needs only the tenant column: the parent
      // *is* the tenant, so there is no second identity that could belong to someone else.
      if (fk.target_table === 'organisations') {
        continue;
      }
      if (!fk.columns.includes('organisation_id')) {
        findings.push({
          rule: 'foreign-key-not-composite',
          subject: `${fk.table_name}.${fk.constraint_name}`,
          detail:
            `references ${fk.target_table} without organisation_id. A row could then point at ` +
            'another tenant’s row, which row-level security does not prevent.',
        });
      }
    }

    for (const fn of (await pool.query<FunctionRow>(FUNCTION_QUERY)).rows) {
      const approved = APPROVED_DEFINERS[fn.function_name];
      if (!definers.has(fn.function_name) || fn.identity_arguments !== approved?.arguments) {
        findings.push({
          rule: 'security-definer-not-allowlisted',
          subject: fn.function_name,
          detail:
            'is SECURITY DEFINER and not in docs/architecture/security-definer-allowlist.md. ' +
            'These are the only sanctioned way across a tenant boundary and each one is reviewed.',
        });
      }
      if (fn.search_path === null) {
        findings.push({
          rule: 'security-definer-unpinned-search-path',
          subject: fn.function_name,
          detail:
            'is SECURITY DEFINER with no pinned search_path, so its caller chooses which functions ' +
            'and tables it resolves to — a privilege-escalation primitive.',
        });
      }
      if (approved !== undefined) {
        if (!approved.owners.includes(fn.owner_name)) {
          findings.push({
            rule: 'security-definer-unsafe-owner',
            subject: fn.function_name,
            detail: `owner ${fn.owner_name} is not one of the reviewed owners.`,
          });
        }
        if (fn.search_path !== approved.searchPath) {
          findings.push({
            rule: 'security-definer-unsafe-search-path',
            subject: fn.function_name,
            detail: 'search_path differs from the reviewed fixed path.',
          });
        }
        if (fn.execute_grantees.join(',') !== approved.executeGrantees.join(',')) {
          findings.push({
            rule: 'security-definer-unexpected-execute-grant',
            subject: fn.function_name,
            detail: 'explicit EXECUTE grants differ from the reviewed role set.',
          });
        }
      }
    }

    for (const role of (await pool.query<RoleRow>(ROLE_QUERY, [RUNTIME_ROLES])).rows) {
      if (role.rolbypassrls || role.rolsuper) {
        findings.push({
          rule: 'runtime-role-bypasses-rls',
          subject: role.rolname,
          detail: 'has BYPASSRLS or SUPERUSER, which makes every policy above decorative (INV-01).',
        });
      }
    }
  } finally {
    await pool.end();
  }
  return findings;
}

function urlFromArgv(): string {
  const index = process.argv.indexOf('--url');
  if (index !== -1) {
    const value = process.argv[index + 1];
    if (value !== undefined) return value;
  }
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'no database to inspect: pass --url, or set DATABASE_URL. This check reads the running ' +
        'catalog on purpose — the question it answers cannot be answered from the migrations.',
    );
  }
  return url;
}

async function main(): Promise<number> {
  let findings: Finding[];
  try {
    findings = await inspect(urlFromArgv());
  } catch (error) {
    console.error(`RLS catalog check could not run: ${String(error)}`);
    return 1;
  }

  if (findings.length === 0) {
    console.log(
      'RLS catalog: every tenant table is forced and fully policed; no runtime role can bypass it.',
    );
    return 0;
  }

  console.error('Row-level-security catalog findings (INV-01, INV-02):');
  for (const finding of findings) {
    console.error(`  [${finding.rule}] ${finding.subject}`);
    console.error(`    ${finding.detail}`);
  }
  console.error('');
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
