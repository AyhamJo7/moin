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
  'moin_identity',
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
  'app.reject_last_owner_loss': 'e1740991527052f99b632df9de89e767',
  'app.set_user_status': 'c5c9be0702df0f70271f0b245ef1cdda',
  'app.revoke_member_sessions': 'b48a5d42fdbb17ae72377ef873e27067',
  'app.accept_invitation': 'a1d0a2c50a4245314119d580fcd25e18',
  'app.live_support_grant': 'b82400b4dcbf9ef726f75efde1c619ee',
  'app.create_support_grant': '36ac2bbfe4214a0e017b899cb6411707',
  'app.revoke_support_grant': 'a7f4ef52e1b5f0b4e949415424f10385',
  'app.support_read_memberships': '5bd98e08aa79ba2040b6fd1435d40f9c',
  'app.support_read_invitations': '32223553918c6f990711b1fc1fe5da05',
  'app.support_read_audit_events': 'bee24f295a297558550d1c3e55353442',
  'app.support_emergency_read_memberships': '4bb973cb5304a126902fb9fd285c6ee6',
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
  // Sign-in and sessions (P06.06.01/.02/.03): the trigger that fixes a session's lifetime, and
  // the seven functions that are the runtime role's only access to users, auth_transactions,
  // sessions and membership reads. resolve_request_context is the per-request re-check (P06.06.03).
  'app.reject_session_rewrite': '1b7209a5119fd835537b390fcbd558e0',
  'app.begin_sign_in(bytea, bytea, bytea, bytea, text, text)': 'f4ba5d92f3e25bfd5a7e9b9e0ff6bd6c',
  'app.begin_sign_in(bytea, bytea, bytea, bytea, text, text, uuid)':
    '66f0c43b05dce5b3b2a02c9922032376',
  'app.consume_sign_in': '92e1cbedb2906c3eceaec382b390ed44',
  'app.begin_session(text, bytea, uuid, bytea, text, bytea)': '7d8f57a7e0af40b9c4719d0ebced8025',
  'app.begin_session(text, bytea, uuid, bytea, text, bytea, timestamp with time zone)':
    'c627de1097e736c8cfb10771c5e32fbc',
  'app.rotate_session(bytea, bytea, uuid, text)': 'f73e3aa4ae6c66b031451899652551d6',
  'app.rotate_session(bytea, bytea, uuid, text, timestamp with time zone)':
    '251d3d1928195dfcc51055a5368b8b28',
  'app.resolve_session': '3b06721c6c8d393e60ff0bcfaa70477d',
  'app.resolve_request_context': '3e250049a4d4da3be09204c3dc756125',
  // Revocation (P06.06.05): the one implementation, its two entry points and the trigger that
  // calls it on every membership change. A body that returned without revoking would keep every
  // name, owner, signature and grant, and every session would outlive the change that ended it.
  'app.revoke_user_sessions': '80650c9e6230be901acf10aa0ac5e65e',
  'app.revoke_session(bytea)': '73bcf41e304f25de88177ec25cc6a0e7',
  'app.revoke_session(bytea, text)': 'a7fada2daeac2e30e801d6aaeff97b2e',
  'app.revoke_session(uuid, text)': '5e600197d52d7d4f18abe1bf272578b7',
  'app.revoke_sessions_on_membership_change': '7327cf1abdbb5e1b9a08452780f82c44',
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
  'app.begin_sign_in': {
    arguments: 'bytea, bytea, bytea, bytea, text, text, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  // Rolling-window overload (contracted in 0016): old hosts sign in through this 6-arg
  // shim, which delegates with a NULL step-up binding. Same owner/path/grants as the 7-arg form.
  'app.begin_sign_in(bytea, bytea, bytea, bytea, text, text)': {
    arguments: 'bytea, bytea, bytea, bytea, text, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.consume_sign_in': {
    arguments: 'bytea, bytea',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.begin_session': {
    arguments: 'text, bytea, uuid, bytea, text, bytea, timestamp with time zone',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.begin_session(text, bytea, uuid, bytea, text, bytea)': {
    arguments: 'text, bytea, uuid, bytea, text, bytea',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.rotate_session': {
    arguments: 'bytea, bytea, uuid, text, timestamp with time zone',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.rotate_session(bytea, bytea, uuid, text)': {
    arguments: 'bytea, bytea, uuid, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.resolve_session': {
    arguments: 'bytea',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.resolve_request_context': {
    arguments: 'bytea',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  // Revocation (P06.06.05). Two more overloads of `revoke_session` — the bare name, so the
  // seven-name identity set that every host's readiness probe counts does not change mid-rollout.
  'app.revoke_session(bytea)': {
    arguments: 'bytea',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.revoke_session(bytea, text)': {
    arguments: 'bytea, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  'app.revoke_session(uuid, text)': {
    arguments: 'uuid, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_identity'],
  },
  // Nobody executes these two: the empty grantee list is the assertion. The helper runs only from
  // the functions above and the trigger runs only as the table's trigger.
  'app.revoke_user_sessions': {
    arguments: 'uuid, bytea, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: [],
  },
  'app.revoke_sessions_on_membership_change': {
    arguments: '',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: [],
  },
  // Nobody executes it: the empty grantee list is the assertion. Runs only as the table trigger.
  'app.reject_last_owner_loss': {
    arguments: '',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: [],
  },
  'app.set_user_status': {
    arguments: 'uuid, text, text, uuid, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.revoke_member_sessions': {
    arguments: 'uuid, text, text[], uuid, text, uuid, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.live_support_grant': {
    arguments: 'uuid, text, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: [],
  },
  'app.create_support_grant': {
    arguments: 'uuid, text, text, text, integer, uuid, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.revoke_support_grant': {
    arguments: 'uuid, uuid, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    executeGrantees: ['moin_app'],
  },
  'app.support_read_memberships': {
    arguments: 'uuid, text, uuid, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    // P06.11.01 gates this: no EXECUTE until the trusted operator identity + emergency auth check exist.
    executeGrantees: [],
  },
  'app.support_read_invitations': {
    arguments: 'uuid, text, uuid, uuid',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    // P06.11.01 gates this: no EXECUTE until the trusted operator identity + emergency auth check exist.
    executeGrantees: [],
  },
  'app.support_read_audit_events': {
    arguments: 'uuid, text, uuid, uuid, integer',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    // P06.11.01 gates this: no EXECUTE until the trusted operator identity + emergency auth check exist.
    executeGrantees: [],
  },
  'app.support_emergency_read_memberships': {
    arguments: 'uuid, text, uuid, uuid, text',
    owners: ['moin_migrator', 'moin_owner'],
    searchPath: 'search_path=pg_catalog, public, app, pg_temp',
    // P06.11.01 gates this: no EXECUTE until the trusted operator identity + emergency auth check exist.
    executeGrantees: [],
  },
  'app.accept_invitation': {
    arguments: 'uuid, bytea, text, citext, uuid, uuid',
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
  for (const match of text.matchAll(
    /^\|\s*`([a-z0-9_.]+)`(?:\s*\([^)]*\))?\s*\|\s*([^|]+?)\s*\|/gm,
  )) {
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

/**
 * The trigger that ends a person's sessions when their membership changes (P06.06.05, FS-16).
 *
 * Disabled, or `ENABLE` rather than `ENABLE ALWAYS`, it reads as installed and revokes nothing: a
 * role change, a removal or a suspension would leave every session issued for the old answer alive.
 */
const REVOCATION_TRIGGER = {
  table: 'memberships',
  trigger: 'memberships_revoke_sessions',
  fn: 'app.revoke_sessions_on_membership_change()',
  triggerType: 25, // row (1) + update (16) + delete (8); AFTER, so no before bit (2)
} as const;

/**
 * The trigger that keeps at least one active owner per organisation (P06.07.04). Disabled, it
 * reads as installed and protects nothing: the last owner could be removed, demoted or disabled
 * with no error anywhere.
 */
const LAST_OWNER_TRIGGER = {
  table: 'memberships',
  trigger: 'memberships_last_owner',
  fn: 'app.reject_last_owner_loss()',
  triggerType: 25, // row (1) + update (16) + delete (8); AFTER, so no before bit (2)
} as const;

/** The trigger that registers a tenant's chain when its organisation row is created. */
const REGISTRY_TRIGGER = {
  table: 'organisations',
  trigger: 'organisations_register_audit_chain',
  fn: 'app.register_audit_chain()',
} as const;

const ROLE_QUERY = `SELECT rolname::text, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ANY($1)`;

/**
 * The sign-in and session functions, and the one role that may execute them (P06.06, ADR-0003).
 *
 * `moin_identity` is the api task's second pool. It exists so that `moin_app` — which voice and
 * worker hold too — can execute none of these: a session function reachable from the voice role is
 * a session a compromised voice process could mint (QG-09 finding I1). The role is useful only as
 * long as it can do nothing else, so its whole ACL is asserted here rather than assumed. That
 * `moin_app` executes none of the seven follows from `APPROVED_DEFINERS`, whose grantee lists are exact.
 */
const IDENTITY_ROLE = 'moin_identity';
const IDENTITY_FUNCTIONS: readonly string[] = [
  'app.begin_session',
  'app.begin_sign_in',
  'app.consume_sign_in',
  'app.resolve_request_context',
  'app.resolve_session',
  'app.revoke_session',
  'app.rotate_session',
];

// Every schema but PostgreSQL's own (catalog, information schema, toast and temporary schemas) is
// checked, so a grant in a schema added later cannot hide.
const IDENTITY_ROLE_QUERY = `
  SELECT r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
         (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid)::int AS member_of,
         -- PostgreSQL 16+ records an ADMIN-only grant to the CREATEROLE role that created this one
         -- (the RDS master user). ADMIN still lets its holder grant the role onward, itself included,
         -- so the row is tolerated only when the holder is exactly that: CREATEROLE, not one of ours,
         -- and reachable from none of our runtime roles. Any other member is a finding.
         (SELECT count(*) FROM pg_auth_members m JOIN pg_roles h ON h.oid = m.member
          WHERE m.roleid = r.oid
            AND NOT (m.admin_option AND NOT m.inherit_option AND NOT m.set_option
                     AND h.rolcreaterole AND h.rolname NOT LIKE 'moin\\_%'
                     AND NOT EXISTS (SELECT 1 FROM pg_roles rr
                                     WHERE rr.rolname = ANY($2) AND pg_has_role(rr.oid, h.oid, 'MEMBER'))))::int
           AS usable_members,
         (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid)::int
           + (SELECT count(*) FROM pg_proc p WHERE p.proowner = r.oid)::int
           + (SELECT count(*) FROM pg_namespace n WHERE n.nspowner = r.oid)::int
           + (SELECT count(*) FROM pg_type t WHERE t.typowner = r.oid)::int
           + (SELECT count(*) FROM pg_database d WHERE d.datdba = r.oid)::int
           + (SELECT count(*) FROM pg_largeobject_metadata l WHERE l.lomowner = r.oid)::int AS owned,
         has_database_privilege(r.oid, current_database(), 'TEMPORARY') AS can_create_temporary,
         -- CREATE on the database is CREATE SCHEMA, after which the role owns what it makes.
         has_database_privilege(r.oid, current_database(), 'CREATE') AS can_create_schema,
         -- Every other database it could open a session in. Everything here is checked in this
         -- database only, so a second one would be an unchecked place to create objects. PUBLIC
         -- holds CONNECT on every database by default; provisioning revokes it.
         COALESCE((
           SELECT array_agg(d.datname::text ORDER BY d.datname) FROM pg_database d
           WHERE d.datallowconn AND d.datname NOT IN (current_database(), 'moin')
             AND d.datname NOT LIKE 'moin_t_%'
             AND has_database_privilege(r.oid, d.oid, 'CONNECT')
         ), '{}'::text[]) AS other_databases,
         -- Creating a large object needs no privilege beyond EXECUTE on these, which PUBLIC holds
         -- by default; provisioning revokes it.
         (has_function_privilege(r.oid, 'pg_catalog.lo_create(oid)', 'EXECUTE')
          OR has_function_privilege(r.oid, 'pg_catalog.lo_creat(integer)', 'EXECUTE')
          OR has_function_privilege(r.oid, 'pg_catalog.lo_from_bytea(oid, bytea)', 'EXECUTE'))
           AS can_create_large_objects,
         COALESCE((
           SELECT array_agg(n.nspname::text ORDER BY n.nspname) FROM pg_namespace n
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'
             AND has_schema_privilege(r.oid, n.oid, 'CREATE')
         ), '{}'::text[]) AS creatable_schemas,
         COALESCE((
           SELECT array_agg(
             json_build_object(
               'relation', n.nspname || '.' || c.relname,
               'schema', n.nspname::text,
               'name', c.relname::text,
               'kind', c.relkind::text,
               'has_write', (
                 has_table_privilege(r.oid, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                 OR (c.relkind <> 'S' AND has_any_column_privilege(r.oid, c.oid, 'INSERT, UPDATE, REFERENCES'))
                 OR (c.relkind = 'S' AND has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE'))
               ),
               'extension', (
                 SELECT e.extname::text FROM pg_depend dep JOIN pg_extension e ON e.oid = dep.refobjid
                 WHERE dep.classid = 'pg_class'::regclass AND dep.objid = c.oid AND dep.deptype = 'e'
                 LIMIT 1
               ),
               -- Transitive closure over view dependencies: a view that reaches a sensitive
               -- relation through any number of intermediate views still reaches it. One pg_rewrite
               -- join sees only direct deps; the recursion below walks the whole chain.
               'dependencies', COALESCE((
                 WITH RECURSIVE chain(obj) AS (
                   SELECT d.refobjid
                   FROM pg_depend d
                   JOIN pg_rewrite rw ON rw.oid = d.objid
                   WHERE rw.ev_class = c.oid AND d.classid = 'pg_rewrite'::regclass
                     AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> c.oid
                   UNION
                   SELECT d.refobjid
                   FROM pg_depend d
                   JOIN pg_rewrite rw ON rw.oid = d.objid
                   JOIN chain ON chain.obj = rw.ev_class
                   WHERE d.classid = 'pg_rewrite'::regclass
                     AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> c.oid
                 )
                 SELECT array_agg(DISTINCT dn.nspname || '.' || dc.relname)
                 FROM chain
                 JOIN pg_class dc ON dc.oid = chain.obj
                 JOIN pg_namespace dn ON dn.oid = dc.relnamespace
                 WHERE dn.nspname NOT IN ('pg_catalog', 'information_schema')
               ), '{}'::text[])
             )::text
             ORDER BY n.nspname || '.' || c.relname
           )
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'
             AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S')
             AND (has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                  OR (c.relkind <> 'S' AND has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
                  OR (c.relkind = 'S' AND has_sequence_privilege(r.oid, c.oid, 'USAGE, SELECT, UPDATE')))
         ), '{}') AS table_privileges,
         COALESCE((
           SELECT array_agg(DISTINCT n.nspname || '.' || p.proname ORDER BY n.nspname || '.' || p.proname)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE p.prosecdef AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
         ), '{}') AS executable_definers,
         COALESCE((
           SELECT array_agg(DISTINCT n.nspname || '.' || p.proname ORDER BY n.nspname || '.' || p.proname)
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
                aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
           WHERE a.grantee = r.oid
         ), '{}') AS granted_functions,
         (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
          WHERE a.grantee = r.oid AND a.is_grantable)::int
           + (SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a
              WHERE a.grantee = r.oid AND a.is_grantable)::int AS grant_options
  FROM pg_roles r WHERE r.rolname = $1
`;

interface IdentityRoleRow {
  readonly rolsuper: boolean;
  readonly rolbypassrls: boolean;
  readonly rolcreaterole: boolean;
  readonly rolcreatedb: boolean;
  readonly rolreplication: boolean;
  readonly member_of: number;
  readonly usable_members: number;
  readonly owned: number;
  readonly can_create_temporary: boolean;
  readonly can_create_schema: boolean;
  readonly other_databases: string[];
  readonly can_create_large_objects: boolean;
  readonly creatable_schemas: string[];
  readonly table_privileges: string[];
  /** Every SECURITY DEFINER function it can execute, by any route (explicit grant or PUBLIC). */
  readonly executable_definers: string[];
  /** Every function granted to it by name. */
  readonly granted_functions: string[];
  readonly grant_options: number;
}

/**
 * The tables only the session functions may touch. No runtime role — `moin_identity` included —
 * may hold a table or column privilege on them: a direct INSERT into `sessions` is a minted
 * session. `memberships` is here too: the session credential reaches tenant rows only through
 * the pinned `resolve_request_context` join, never by grant — a later `GRANT ... ON memberships
 * TO moin_identity` for convenience would silently open that direct path.
 */
const SESSION_TABLES: readonly string[] = ['auth_transactions', 'sessions', 'users'];

const SESSION_TABLE_ACCESS_QUERY = `
  SELECT r.rolname::text AS role, c.relname::text AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, pg_roles r
  WHERE n.nspname = 'public' AND c.relname = ANY($1) AND r.rolname = ANY($2)
    AND (has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
         OR has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
  ORDER BY 1, 2
`;

/** Effective EXECUTE, by any route — grant, PUBLIC or membership — on the seven, per runtime role. */
const SESSION_FUNCTION_REACH_QUERY = `
  SELECT r.rolname::text AS role, n.nspname || '.' || p.proname AS function_name
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, pg_roles r
  WHERE n.nspname || '.' || p.proname = ANY($1) AND r.rolname = ANY($2)
    AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
  ORDER BY 1, 2
`;

/** Our roles that must not reach the identity role, or the owner of the session functions. */
const REACHING_ROLES: readonly string[] = [...RUNTIME_ROLES, 'moin_readonly'];

/**
 * Membership of any kind — INHERIT, SET or ADMIN, direct or through another role — in the identity
 * role or in the owner of a session function. `has_function_privilege` follows inherited
 * membership only; a role that can `SET ROLE` to the owner, or grant itself the identity role, can
 * still execute the seven.
 */
const SESSION_ROLE_REACH_QUERY = `
  SELECT r.rolname::text AS role, t.rolname::text AS target
  FROM pg_roles r, pg_roles t
  WHERE r.rolname = ANY($1) AND r.rolname <> $3
    AND (t.rolname = $3 OR t.oid IN (
      SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname || '.' || p.proname = ANY($2)))
    AND pg_has_role(r.oid, t.oid, 'MEMBER')
  ORDER BY 1, 2
`;

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
    // Overload-aware approval: the key is name + argument list. The 6-arg begin_sign_in
    // shim is a second approved signature of the same name (contracted in 0016).
    const approvedFor = (
      fn: FunctionRow,
    ): { key: string; approved: (typeof APPROVED_DEFINERS)[string] | undefined } => {
      const keyed = APPROVED_DEFINERS[`${fn.function_name}(${fn.identity_arguments})`];
      if (keyed !== undefined)
        return { key: `${fn.function_name}(${fn.identity_arguments})`, approved: keyed };
      return { key: fn.function_name, approved: APPROVED_DEFINERS[fn.function_name] };
    };
    for (const fn of functions) {
      const { key, approved } = approvedFor(fn);
      if (fn.identity_arguments === approved?.arguments) {
        reviewedFunctionsSeen.add(key);
        // The rolling-window shims are SECURITY INVOKER by design (Defect 3): they must
        // not count as DEFINERs, or old-host readiness (total = 7) breaks on deploy.
        // Every other approved signature stays DEFINER-only.
        const invokerAllowed =
          key === 'app.begin_sign_in(bytea, bytea, bytea, bytea, text, text)' ||
          key === 'app.begin_session(text, bytea, uuid, bytea, text, bytea)' ||
          key === 'app.rotate_session(bytea, bytea, uuid, text)' ||
          key === 'app.revoke_session(bytea)';
        if (!fn.security_definer && !invokerAllowed) {
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

    if (present.has(REVOCATION_TRIGGER.table) && present.has('sessions')) {
      const triggers = (
        await pool.query<AuditTriggerRow>(AUDIT_TRIGGER_QUERY, [
          REVOCATION_TRIGGER.table,
          REVOCATION_TRIGGER.fn,
        ])
      ).rows;
      const guard = triggers.find((trigger) => trigger.name === REVOCATION_TRIGGER.trigger);
      if (
        guard?.enabled !== TRIGGER_ALWAYS ||
        guard.trigger_type !== REVOCATION_TRIGGER.triggerType ||
        !guard.correct_function
      ) {
        findings.push({
          rule: 'session-revocation-trigger-unsafe',
          subject: REVOCATION_TRIGGER.table,
          detail:
            'the trigger that revokes sessions when a membership changes is absent, disabled, not ' +
            'ENABLE ALWAYS (so replica mode skips it), covers different events, or points at a ' +
            'different function, so a role change or removal would leave old sessions alive.',
        });
      }
    }

    if (present.has(LAST_OWNER_TRIGGER.table)) {
      const triggers = (
        await pool.query<AuditTriggerRow>(AUDIT_TRIGGER_QUERY, [
          LAST_OWNER_TRIGGER.table,
          LAST_OWNER_TRIGGER.fn,
        ])
      ).rows;
      const guard = triggers.find((trigger) => trigger.name === LAST_OWNER_TRIGGER.trigger);
      if (
        guard?.enabled !== TRIGGER_ALWAYS ||
        guard.trigger_type !== LAST_OWNER_TRIGGER.triggerType ||
        !guard.correct_function
      ) {
        findings.push({
          rule: 'last-owner-trigger-unsafe',
          subject: LAST_OWNER_TRIGGER.table,
          detail:
            'the trigger that keeps at least one active owner is absent, disabled, not ' +
            'ENABLE ALWAYS (so replica mode skips it), covers different events, or points at a ' +
            'different function, so the last owner could be removed, demoted or disabled.',
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

    // Function bodies, pinned by name + argument list: two overloads share a bare name
    // but never a body (the 6-arg begin_sign_in shim delegates; the 7-arg form inserts).
    // See REVIEWED_BODIES for why identity is not enough.
    const seenBodies = new Set<string>();
    for (const fn of functions) {
      const key = `${fn.function_name}(${fn.identity_arguments})`;
      const expected = REVIEWED_BODIES[key] ?? REVIEWED_BODIES[fn.function_name];
      if (expected === undefined) continue;
      seenBodies.add(REVIEWED_BODIES[key] !== undefined ? key : fn.function_name);
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

    findings.push(...(await inspectIdentityRole(pool)), ...(await inspectSessionBoundary(pool)));
  } finally {
    await pool.end();
  }
  return findings;
}

export interface ReviewedExtensionView {
  readonly schema: string;
  readonly name: string;
  readonly extension: string;
}

/**
 * Reviewed extension views that moin_identity is permitted to read.
 * Default is zero: moin_identity needs no direct relation access of any kind.
 */
export const REVIEWED_EXTENSION_VIEWS: readonly ReviewedExtensionView[] = [];

/**
 * Relations that must never be reachable, directly or through any depth of view nesting.
 * Fully qualified `schema.name`: a bare table name would collide across schemas in either
 * direction (false pass on `evil.sessions`, false alarm on an unrelated `sessions` elsewhere).
 */
export const SENSITIVE_RELATIONS: ReadonlySet<string> = new Set([
  'public.sessions',
  'public.auth_transactions',
  'public.users',
  'public.organisations',
  'public.locations',
  'public.audit_events',
  'public.audit_heads',
  'public.audit_chain_registry',
  'public.provisioning_requests',
]);

interface RelationPrivilegeInfo {
  readonly relation: string;
  readonly schema: string;
  readonly name: string;
  readonly kind: string;
  readonly has_write: boolean;
  readonly extension: string | null;
  readonly dependencies: readonly string[];
}

/**
 * The whole ACL of the identity role. Exported with the role as a parameter so the membership rule
 * can be exercised on throwaway roles: membership is cluster-wide, so it is never mutated on the
 * shared `moin_identity` in a test.
 */
export async function inspectIdentityRole(
  pool: ReturnType<typeof createPool>,
  role: string = IDENTITY_ROLE,
  options?: { readonly allowedExtensionViews?: readonly ReviewedExtensionView[] },
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const row = (await pool.query<IdentityRoleRow>(IDENTITY_ROLE_QUERY, [role, REACHING_ROLES]))
    .rows[0];
  if (row === undefined) {
    return [
      {
        rule: 'identity-role-missing',
        subject: role,
        detail: 'the role that alone may execute the session functions does not exist.',
      },
    ];
  }
  const push = (rule: string, detail: string): void => {
    findings.push({ rule, subject: role, detail });
  };
  if (
    row.rolsuper ||
    row.rolbypassrls ||
    row.rolcreaterole ||
    row.rolcreatedb ||
    row.rolreplication
  ) {
    push(
      'identity-role-privileged',
      'has a role attribute (SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION).',
    );
  }
  if (row.member_of > 0 || row.usable_members > 0) {
    push(
      'identity-role-membership',
      'is a member of a role, or has a member other than an ADMIN-only grant to the CREATEROLE role that created it (not one of ours, reachable from none of our runtime roles): either extends or shares what it may do.',
    );
  }
  if (row.owned > 0) {
    push(
      'identity-role-owns-objects',
      'owns a table, function, type, schema, database or large object; an owner holds every privilege on what it owns.',
    );
  }
  if (row.can_create_large_objects) {
    push(
      'identity-role-large-object',
      'may create large objects (lo_create, lo_creat, lo_from_bytea); it may create nothing.',
    );
  }
  if (row.can_create_temporary) {
    push(
      'identity-role-temporary',
      'may create temporary objects in this database; it may create nothing.',
    );
  }
  if (row.can_create_schema) {
    push(
      'identity-role-database-create',
      'holds CREATE on this database, so it may create a schema and own what it puts there.',
    );
  }
  if (row.other_databases.length > 0) {
    push(
      'identity-role-other-database',
      `may connect to ${row.other_databases.join(', ')}; it may connect to this database alone, where its privileges are checked.`,
    );
  }
  if (row.creatable_schemas.length > 0) {
    push(
      'identity-role-schema-create',
      `may create objects in ${row.creatable_schemas.join(', ')}.`,
    );
  }
  const allowedViews = options?.allowedExtensionViews ?? REVIEWED_EXTENSION_VIEWS;
  for (const raw of row.table_privileges) {
    const rel = (
      typeof raw === 'string' && raw.startsWith('{')
        ? JSON.parse(raw)
        : {
            relation: raw,
            schema: '',
            name: raw,
            kind: 'r',
            has_write: true,
            extension: null,
            dependencies: [],
          }
    ) as RelationPrivilegeInfo;
    const isAllowlisted = allowedViews.some(
      (a) =>
        a.schema === rel.schema &&
        a.name === rel.name &&
        a.extension === rel.extension &&
        rel.kind === 'v',
    );
    if (!isAllowlisted) {
      push(
        'identity-role-table-privilege',
        `holds a table or column privilege on ${rel.relation}; it may reach data only through the session functions.`,
      );
      continue;
    }
    if (rel.has_write) {
      push(
        'identity-role-table-privilege',
        `holds a write privilege on allowlisted extension view ${rel.relation}; extension views must be strictly read-only.`,
      );
    }
    for (const dep of rel.dependencies) {
      if (SENSITIVE_RELATIONS.has(dep)) {
        push(
          'identity-role-table-privilege',
          `extension view ${rel.relation} depends on sensitive relation ${dep}; forbidden.`,
        );
      }
    }
  }
  if (row.grant_options > 0) {
    push(
      'identity-role-grant-option',
      'holds a privilege WITH GRANT OPTION, so it could hand the session functions to another role.',
    );
  }
  // Invoker functions any role may run (extension helpers, `app.current_org`) execute with the
  // caller's own privileges, so they give this role nothing. What could give it something is a
  // definer function, or a grant by name: both must be exactly the seven session functions, with
  // the rolling-window begin_sign_in overload collapsing to its bare name (contracted in 0016).
  for (const [kind, functions] of [
    ['SECURITY DEFINER functions it can execute', row.executable_definers],
    ['functions granted to it', row.granted_functions],
  ] as const) {
    const collapsed = [...new Set(functions)];
    if (collapsed.join(',') !== IDENTITY_FUNCTIONS.join(',')) {
      push(
        'identity-role-unexpected-execute',
        `${kind}: ${collapsed.join(', ') || 'none'}; must be exactly ${IDENTITY_FUNCTIONS.join(', ')}.`,
      );
    }
  }
  return findings;
}

/** No other runtime role reaches the session functions or tables. */
async function inspectSessionBoundary(pool: ReturnType<typeof createPool>): Promise<Finding[]> {
  const findings: Finding[] = [];
  const others = RUNTIME_ROLES.filter((role) => role !== IDENTITY_ROLE);
  const reach = await pool.query<{ role: string; function_name: string }>(
    SESSION_FUNCTION_REACH_QUERY,
    [IDENTITY_FUNCTIONS, others],
  );
  for (const row of reach.rows) {
    findings.push({
      rule: 'session-function-reachable',
      subject: row.function_name,
      detail: `${row.role} can execute it — by grant, PUBLIC or membership; only ${IDENTITY_ROLE} may.`,
    });
  }
  const reachable = await pool.query<{ role: string; target: string }>(SESSION_ROLE_REACH_QUERY, [
    REACHING_ROLES,
    IDENTITY_FUNCTIONS,
    IDENTITY_ROLE,
  ]);
  for (const row of reachable.rows) {
    findings.push({
      rule: 'session-role-reachable',
      subject: row.target,
      detail: `${row.role} is a member of ${row.target} (by INHERIT, SET or ADMIN, directly or not), so it could act with its privileges over the session functions.`,
    });
  }
  const access = await pool.query<{ role: string; table_name: string }>(
    SESSION_TABLE_ACCESS_QUERY,
    [SESSION_TABLES, RUNTIME_ROLES],
  );
  for (const row of access.rows) {
    findings.push({
      rule: 'session-table-privilege',
      subject: row.table_name,
      detail: `${row.role} holds a table or column privilege on it; only the session functions may touch it.`,
    });
  }
  // `memberships` is intentionally NOT in SESSION_TABLES: it needs `moin_app` DML by design
  // (reads on every request, writes on disable/remove). What must never happen is the session
  // credential holding a direct grant on it — the DEFINER join is the only path. Assert that
  // narrowly: any table or column privilege for `moin_identity` on `memberships` fails.
  const identityAccess = await pool.query<{ table_name: string }>(
    `SELECT c.relname::text AS table_name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'memberships'
       AND (has_table_privilege('moin_identity', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
            OR has_any_column_privilege('moin_identity', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))`,
  );
  for (const row of identityAccess.rows) {
    findings.push({
      rule: 'identity-role-membership-privilege',
      subject: row.table_name,
      detail:
        'moin_identity holds a table or column privilege on it; the session credential reaches tenant rows only through the pinned resolve_request_context join, never by grant.',
    });
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
