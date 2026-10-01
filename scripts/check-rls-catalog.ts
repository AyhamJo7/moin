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
  readonly security_definer: boolean;
  readonly owner_name: string;
  readonly search_path: string | null;
  readonly execute_grantees: string[];
  readonly body_digest: string;
}

/**
 * Reviewed function bodies, pinned by digest (P06.10, INV-10, QG-09).
 *
 * Every other rule here pins a function's *identity* — signature, owner, `search_path`, grants,
 * `prosecdef` — and none of them says anything about what it does. `CREATE OR REPLACE FUNCTION
 * app.reject_registry_mutation() … BEGIN RETURN NEW; END` keeps the same OID, name, owner and
 * signature while removing the guard outright: cheaper than repointing a trigger, and invisible to
 * every identity rule. The same replacement on `app.append_audit_event` deletes the argument policy.
 *
 * So the body is pinned too. A deliberate change to any of these is a one-line edit here, which is
 * the point: it puts the change in front of a reviewer instead of letting it pass as a no-op.
 *
 * Behavioural probes were the alternative and are weaker in the case that matters: a row-level
 * `BEFORE UPDATE` trigger does not fire on an empty table, so a probe would have to write audit
 * rows to prove anything, and a read-only catalog check that mutates the database to test itself is
 * a bad trade. The digest holds whether or not the table has rows.
 */
const REVIEWED_BODIES: Readonly<Record<string, string>> = {
  // The append-only and register guards, and the two chain-integrity guards.
  'app.reject_audit_mutation': '42ea8b78a19fbe7aeb537d96a6087e14',
  'app.reject_registry_mutation': '60ee49a225936633fc8512cfa1d85049',
  'app.reject_audit_head_rewrite': 'c9278e84aa3190487818218e3ca4f761',
  'app.reject_unlinked_audit_event': '7c2302af293e06986eb4fbec32b90362',
  'app.register_audit_chain': '221bd18d0326d55150a2405786768fa8',
  // The privileged writers and readers.
  'app.append_audit_event': 'e8a2fff1d6b97ee844313730cf63ef29',
  'app.audit_canonical_payload': 'ff85e1e923f72ea01658e627de79b719',
  'app.audit_provisioning_request': '9af333f9b77604a27d522f64fd020a07',
  'app.claim_audit_chains': 'd11d35da7fbd6c2a439631b363b03f79',
  'app.unregistered_audit_chains': '280c72481f5bfcdb4eab663d46840947',
  'app.count_audit_chains': 'e3cd033e0ea860c723977f7c9e28068a',
  'app.audit_chain_high_water': '0af3ae3c87f468ecd845b318be7efb52',
  'app.provision_tenant': '187d4a4589e54a39cdadc6f3726cce26',
};

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
  'app.claim_audit_chains': {
    arguments: 'integer, bigint, bigint',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.unregistered_audit_chains': {
    arguments: 'integer',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.audit_chain_high_water': {
    arguments: '',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.count_audit_chains': {
    arguments: 'bigint, bigint',
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
         p.prosecdef AS security_definer,
         pg_get_userbyid(p.proowner)::text AS owner_name,
         (SELECT s FROM unnest(COALESCE(p.proconfig, '{}')) s WHERE s LIKE 'search_path=%') AS search_path,
         md5(p.prosrc)::text AS body_digest,
         COALESCE((SELECT array_agg((CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)::text ORDER BY a.grantee)
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
           WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner), ARRAY[]::text[]) AS execute_grantees
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'app')
`;

const AUDIT_TRIGGER_TYPE = 27; // row (1) + before (2) + delete (8) + update (16)
const TRUNCATE_TRIGGER_TYPE = 34; // before (2) + truncate (32), statement-level
const INSERT_TRIGGER_TYPE = 7; // row (1) + before (2) + insert (4)

/**
 * `ENABLE ALWAYS`, not the default `ENABLE`.
 *
 * `tgenabled = 'O'` is "origin only": the trigger does not fire when `session_replication_role` is
 * `replica`. That is a session setting, not DDL, so accepting `'O'` would bless a configuration in
 * which a guard can be switched off with no schema change and nothing left behind to find. `'A'`
 * fires in replica mode too, which is the only useful setting for a guard meant to be unavoidable.
 */
const TRIGGER_ALWAYS = 'A';

interface AuditTriggerRow {
  readonly name: string;
  readonly enabled: string;
  readonly trigger_type: number;
  readonly correct_function: boolean;
}

const AUDIT_TRIGGER_QUERY = `
  SELECT t.tgname::text AS name, t.tgenabled::text AS enabled,
         t.tgtype::int AS trigger_type,
         COALESCE(t.tgfoid = to_regprocedure($2), false) AS correct_function
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = $1 AND NOT t.tgisinternal
`;

/**
 * The append-only guards, each named with the exact function it must call.
 *
 * `audit_chain_registry` is here for the same reason `audit_events` is: it is the list of chains the
 * daily verifier walks, so a deletable registration would make "remove the row" the cheapest way to
 * hide a tampered chain — the sweep would skip that tenant and report a clean run.
 */
const APPEND_ONLY_TABLES: readonly {
  readonly table: string;
  readonly trigger: string;
  readonly fn: string;
  /** Row-level BEFORE UPDATE OR DELETE (27), or statement-level BEFORE TRUNCATE (36). */
  readonly triggerType: number;
}[] = [
  {
    table: 'audit_events',
    trigger: 'audit_events_append_only',
    fn: 'app.reject_audit_mutation()',
    triggerType: AUDIT_TRIGGER_TYPE,
  },
  {
    table: 'audit_events',
    trigger: 'audit_events_no_truncate',
    fn: 'app.reject_audit_mutation()',
    triggerType: TRUNCATE_TRIGGER_TYPE,
  },
  {
    // Without this an event can be written at any sequence with any hashes, and verification —
    // which never reads past the head — reports the chain sound.
    table: 'audit_events',
    trigger: 'audit_events_linked_only',
    fn: 'app.reject_unlinked_audit_event()',
    triggerType: INSERT_TRIGGER_TYPE,
  },
  {
    // The head is the verifier's upper bound, so rolling it back silences the sweep for that
    // tenant without touching a single committed event.
    table: 'audit_heads',
    trigger: 'audit_heads_advance_only',
    fn: 'app.reject_audit_head_rewrite()',
    triggerType: AUDIT_TRIGGER_TYPE,
  },
  {
    table: 'audit_heads',
    trigger: 'audit_heads_no_truncate',
    fn: 'app.reject_audit_mutation()',
    triggerType: TRUNCATE_TRIGGER_TYPE,
  },
  {
    table: 'audit_chain_registry',
    trigger: 'audit_chain_registry_append_only',
    fn: 'app.reject_registry_mutation()',
    triggerType: AUDIT_TRIGGER_TYPE,
  },
  {
    table: 'audit_chain_registry',
    trigger: 'audit_chain_registry_no_truncate',
    fn: 'app.reject_registry_mutation()',
    triggerType: TRUNCATE_TRIGGER_TYPE,
  },
];

/** The trigger that registers a tenant's chain when its organisation row is created. */
const REGISTRY_TRIGGER = {
  table: 'organisations',
  trigger: 'organisations_register_audit_chain',
  fn: 'app.register_audit_chain()',
} as const;

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

    const functions = (await pool.query<FunctionRow>(FUNCTION_QUERY)).rows;
    const reviewedFunctionsSeen = new Set<string>();
    for (const fn of functions) {
      const approved = APPROVED_DEFINERS[fn.function_name];
      if (fn.identity_arguments === approved?.arguments) {
        reviewedFunctionsSeen.add(fn.function_name);
        if (!fn.security_definer) {
          findings.push({
            rule: 'reviewed-function-not-security-definer',
            subject: fn.function_name,
            detail: 'reviewed privileged function was changed to SECURITY INVOKER.',
          });
        }
      }
      if (!fn.security_definer) continue;
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
    for (const name of Object.keys(APPROVED_DEFINERS)) {
      if (!reviewedFunctionsSeen.has(name)) {
        findings.push({
          rule: 'reviewed-function-missing',
          subject: name,
          detail: 'the exact reviewed privileged function signature is absent from the catalog.',
        });
      }
    }

    const present = new Set(tables.map((table) => table.table_name));
    for (const guarded of APPEND_ONLY_TABLES) {
      if (!present.has(guarded.table)) continue;
      const triggers = (
        await pool.query<AuditTriggerRow>(AUDIT_TRIGGER_QUERY, [guarded.table, guarded.fn])
      ).rows;
      const guard = triggers.find((trigger) => trigger.name === guarded.trigger);
      if (guard === undefined) {
        findings.push({
          rule: 'audit-append-only-trigger-missing',
          subject: `${guarded.table}.${guarded.trigger}`,
          detail: 'the reviewed guard trigger is absent.',
        });
      } else if (
        guard.enabled !== TRIGGER_ALWAYS ||
        guard.trigger_type !== guarded.triggerType ||
        !guard.correct_function
      ) {
        findings.push({
          rule: 'audit-append-only-trigger-unsafe',
          subject: `${guarded.table}.${guarded.trigger}`,
          detail:
            'the reviewed guard trigger is disabled, is not ENABLE ALWAYS (so replica mode skips ' +
            'it), covers different events, or points at a different function.',
        });
      }
    }

    // Without this trigger a new tenant is never registered, so the daily verifier silently stops
    // covering it — a gap that looks exactly like "no breaks found".
    if (present.has(REGISTRY_TRIGGER.table) && present.has('audit_chain_registry')) {
      const triggers = (
        await pool.query<AuditTriggerRow>(AUDIT_TRIGGER_QUERY, [
          REGISTRY_TRIGGER.table,
          REGISTRY_TRIGGER.fn,
        ])
      ).rows;
      const guard = triggers.find((trigger) => trigger.name === REGISTRY_TRIGGER.trigger);
      if (guard?.enabled !== TRIGGER_ALWAYS || !guard.correct_function) {
        findings.push({
          rule: 'audit-chain-registration-trigger-unsafe',
          subject: REGISTRY_TRIGGER.table,
          detail:
            'the trigger registering a new tenant’s audit chain is absent, disabled or changed, ' +
            'so the daily verifier would stop covering new tenants without reporting anything.',
        });
      }
    }

    // The register must account for every provisioned tenant. Nothing else compares the two, so a
    // registration trigger disabled and re-enabled around one insert would leave that tenant
    // outside the daily sweep with nothing in the catalog to show it.
    if (present.has('audit_chain_registry') && present.has('provisioning_requests')) {
      const gap = await pool.query<{ n: string }>(
        `select count(*)::text as n from (
           select distinct r.tenant_id from provisioning_requests r
           where r.tenant_id is not null
             and not exists (select 1 from audit_chain_registry c where c.tenant_id = r.tenant_id)
         ) missing`,
      );
      const missing = Number(gap.rows[0]?.n ?? '0');
      if (missing > 0) {
        findings.push({
          rule: 'audit-chain-registry-incomplete',
          subject: 'audit_chain_registry',
          detail:
            `${String(missing)} provisioned tenant(s) have no register row, so the daily verifier ` +
            'never walks their chain and reports a clean run without them.',
        });
      }
    }

    // Function bodies, pinned. See REVIEWED_BODIES for why identity is not enough.
    const seenBodies = new Set<string>();
    for (const fn of functions) {
      const expected = REVIEWED_BODIES[fn.function_name];
      if (expected === undefined) continue;
      seenBodies.add(fn.function_name);
      if (fn.body_digest !== expected) {
        findings.push({
          rule: 'reviewed-function-body-changed',
          subject: fn.function_name,
          detail:
            'its body no longer matches the reviewed digest. A guard can be replaced with one that ' +
            'returns without raising, keeping its name, owner, signature and triggers intact.',
        });
      }
    }
    for (const name of Object.keys(REVIEWED_BODIES)) {
      if (!seenBodies.has(name)) {
        findings.push({
          rule: 'reviewed-function-body-missing',
          subject: name,
          detail: 'a reviewed guard or privileged function is absent from the catalog.',
        });
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
