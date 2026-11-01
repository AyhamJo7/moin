/**
 * Migration safety check (P02.06.04, QG-08, INV-17).
 *
 * A migration is reviewed by a human, but the failure modes here are the kind a reviewer reading
 * a diff genuinely does miss: a `DROP COLUMN` that is fine in isolation and breaks the previous
 * release still running beside it, or an `ALTER TABLE` that takes an ACCESS EXCLUSIVE lock on a
 * table under load and stops every query on it.
 *
 * Two rules underpin the checks:
 *
 * **Expand/contract.** A rolling deploy runs the old and new releases at the same time, so a
 * migration must be compatible with the release before it. Removing a column, renaming one, or
 * narrowing a type breaks the old code the moment it runs. The remove half happens in a later
 * release, once nothing reads it.
 *
 * **Locks are the outage.** `ALTER TABLE … ADD COLUMN … DEFAULT` is cheap on modern Postgres, but
 * adding a `NOT NULL` without a default rewrites the table, and creating an index without
 * `CONCURRENTLY` blocks writes for its duration.
 *
 *   node scripts/check-migrations.ts
 *   node scripts/check-migrations.ts --dir some/fixture/dir
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = join(REPO_ROOT, 'packages', 'db', 'migrations');

const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly detail: string;
}

/**
 * Destructive statements. Each breaks the release still running beside the new one.
 *
 * An intentional contract migration carries the marker below, which forces the author to state
 * that the expand half has already shipped — a sentence a reviewer can check.
 */
const DESTRUCTIVE: readonly Rule[] = [
  {
    id: 'drop-column',
    pattern: /\bALTER\s+TABLE\b[\s\S]{0,200}?\bDROP\s+COLUMN\b/i,
    detail:
      'A DROP COLUMN breaks the previous release, which is still running during a rolling deploy. ' +
      'Ship the expand half first, stop reading the column, then drop it in a later release.',
  },
  {
    id: 'drop-table',
    pattern: /\bDROP\s+TABLE\b/i,
    detail: 'DROP TABLE is irreversible and breaks the previous release.',
  },
  {
    id: 'rename',
    pattern: /\bALTER\s+TABLE\b[\s\S]{0,200}?\bRENAME\b/i,
    detail:
      'A rename is a drop and an add at once: the previous release still refers to the old name. ' +
      'Add the new name, backfill, migrate readers, then remove the old one.',
  },
  {
    id: 'drop-not-null-column-add',
    pattern: /\bADD\s+COLUMN\b(?:(?!DEFAULT)[\s\S]){0,120}?\bNOT\s+NULL\b(?![\s\S]{0,80}?DEFAULT)/i,
    detail:
      'ADD COLUMN ... NOT NULL without a DEFAULT rewrites the whole table under an ACCESS ' +
      'EXCLUSIVE lock, and fails outright if any row exists. Add it nullable, backfill as a job, ' +
      'then add the constraint.',
  },
  {
    id: 'truncate',
    pattern: /\bTRUNCATE\b/i,
    detail: 'TRUNCATE destroys data and cannot be rolled forward.',
  },
];

/** Statements that take a heavy lock. Each has a concurrent or online alternative. */
const LOCKING: readonly Rule[] = [
  {
    id: 'create-index-blocking',
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?![\s\S]{0,40}?\bCONCURRENTLY\b)/i,
    detail:
      'An unqualified CREATE INDEX blocks writes on the table for its duration. Use CONCURRENTLY, ' +
      'which cannot run inside a transaction, so it belongs in its own migration.',
  },
  {
    id: 'add-foreign-key-validated',
    pattern:
      /\bADD\s+CONSTRAINT\b[\s\S]{0,200}?\bFOREIGN\s+KEY\b(?![\s\S]{0,120}?\bNOT\s+VALID\b)/i,
    detail:
      'Adding a validated FOREIGN KEY scans and locks both tables. Add it NOT VALID, then ' +
      'VALIDATE CONSTRAINT in a separate migration, which takes only a SHARE UPDATE EXCLUSIVE lock.',
  },
  {
    id: 'add-check-validated',
    pattern: /\bADD\s+CONSTRAINT\b[\s\S]{0,200}?\bCHECK\b(?![\s\S]{0,120}?\bNOT\s+VALID\b)/i,
    detail:
      'Adding a validated CHECK constraint scans the whole table under an ACCESS EXCLUSIVE lock. ' +
      'Add it NOT VALID, then VALIDATE CONSTRAINT separately.',
  },
  {
    id: 'alter-column-type',
    pattern: /\bALTER\s+COLUMN\b[\s\S]{0,80}?\bTYPE\b/i,
    detail:
      'Changing a column type rewrites the table under an ACCESS EXCLUSIVE lock. Add a new ' +
      'column, backfill, switch readers, then remove the old one.',
  },
];

/**
 * A migration may opt out by stating why, in the file.
 *
 * Deliberately a sentence rather than a flag: `-- migration-check: ignore drop-column` alone
 * would become a reflex. Requiring a reason on the same line means a reviewer sees the claim.
 */
const ALLOW = /--\s*migration-check:\s*allow\s+([a-z-]+)\s+because\s+(.+)/gi;

/**
 * Tenant row-level security goes through `app.apply_tenant_rls` (P06.02.02, INV-01).
 *
 * The helper is the single implementation of the policy; a migration that writes its own
 * ENABLE/FORCE/CREATE POLICY drifts from it (fourteen tables did), and a drifted copy is a policy
 * nobody reads again. The catalog check (scripts/check-rls-catalog.ts) judges the result; this
 * rule keeps new migrations from growing another copy.
 *
 * These twelve migrations predate the rule and are grandfathered by name, with the tables they
 * cover. They are never rewritten (an applied migration is immutable); consolidating them is a
 * separate forward migration. Nothing is added to this list: a new migration uses the helper or
 * states why not with `-- migration-check: allow tenant-rls-not-via-helper because …`.
 */
export const HAND_WRITTEN_RLS_GRANDFATHERED: Readonly<Record<string, readonly string[]>> = {
  '0062_job_envelope.sql': ['job_runs'],
  '0063_outbox.sql': ['outbox'],
  '0065_idempotency_keys.sql': ['idempotency_keys'],
  '0067_timers.sql': ['timers'],
  '0068_sse_outbox.sql': ['sse_events'],
  '0069_feature_flags.sql': ['tenant_flag_overrides'],
  '0071_notifications.sql': ['notifications', 'notification_prefs'],
  '0072_escalation.sql': ['escalation_chains', 'escalation_acks'],
  '0073_deliveries.sql': ['notification_deliveries'],
  '0074_passages.sql': ['knowledge_passages'],
  '0075_slot_holds.sql': ['slot_holds'],
  '0076_slot_exclude.sql': ['booking_confirms'],
};

/**
 * Tables that carry an `organisation_id` column and deliberately have no row-level security: the
 * request-to-tenant mapping is read before any tenant context exists. Each is on the global
 * register (docs/architecture/global-tables.md) with its reason, which the catalog check enforces.
 */
const GLOBAL_TABLES_WITH_ORGANISATION_COLUMN: ReadonlySet<string> = new Set([
  'provisioning_requests',
]);

/** The name and body of each `CREATE TABLE name ( … )`, parentheses balanced. */
function createTables(sql: string): { name: string; body: string }[] {
  const tables: { name: string; body: string }[] = [];
  const head = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?"?(\w+)"?\s*\(/gi;
  for (const match of sql.matchAll(head)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < sql.length && depth > 0) {
      if (sql[end] === '(') depth += 1;
      else if (sql[end] === ')') depth -= 1;
      end += 1;
    }
    tables.push({ name: match[1] ?? '', body: sql.slice(start, end - 1) });
  }
  return tables;
}

function tenantRlsFindings(file: string, code: string): Finding[] {
  if (HAND_WRITTEN_RLS_GRANDFATHERED[file] !== undefined) return [];
  // The migration that defines the helper necessarily contains the statements it runs.
  if (/\bFUNCTION\s+app\.apply_tenant_rls\b/i.test(code)) return [];
  const detail: string[] = [];
  const usesHelper = /\bapply_tenant_rls\s*\(/i.test(code);
  // Only ENABLE: `NO FORCE` … `FORCE` around a backfill is a toggle on a table the helper already set up.
  if (/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(code)) {
    detail.push('enables row-level security by hand');
  }
  if (/\bCREATE\s+POLICY\b/i.test(code) && !usesHelper) {
    detail.push('writes a policy by hand without app.apply_tenant_rls');
  }
  for (const table of createTables(code)) {
    if (GLOBAL_TABLES_WITH_ORGANISATION_COLUMN.has(table.name)) continue;
    // A column definition named organisation_id, not a mention in a foreign-key column list.
    if (!/(?:^|[\n,])\s*"?organisation_id"?\s+[a-z]/i.test(table.body)) continue;
    const applied = new RegExp(`apply_tenant_rls\\s*\\(\\s*'(?:\\w+\\.)?"?${table.name}"?'`, 'i');
    if (!applied.test(code)) {
      detail.push(
        `creates tenant table ${table.name} without SELECT app.apply_tenant_rls('${table.name}')`,
      );
    }
  }
  if (detail.length === 0) return [];
  return [
    {
      file,
      rule: 'tenant-rls-not-via-helper',
      detail:
        `${detail.join('; ')}. Tenant policy has one implementation, app.apply_tenant_rls; a ` +
        'hand-written copy drifts from it.',
    },
  ];
}

export function checkSql(file: string, sql: string): Finding[] {
  const allowed = new Map<string, string>();
  for (const match of sql.matchAll(ALLOW)) {
    allowed.set((match[1] ?? '').toLowerCase(), (match[2] ?? '').trim());
  }

  const findings: Finding[] = [];
  for (const rule of [...DESTRUCTIVE, ...LOCKING]) {
    if (!rule.pattern.test(stripComments(sql))) continue;
    const reason = allowed.get(rule.id);
    if (reason !== undefined && reason.length > 0) continue;
    findings.push({ file, rule: rule.id, detail: rule.detail });
  }
  const tenant = tenantRlsFindings(file, stripComments(sql));
  const tenantReason = allowed.get('tenant-rls-not-via-helper');
  if (tenantReason === undefined || tenantReason.length === 0) findings.push(...tenant);
  return findings;
}

/** Comments must not trigger a rule — a note mentioning DROP COLUMN is not a DROP COLUMN. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

export function checkDirectory(directory: string): Finding[] {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const findings: Finding[] = [];
  const versions = new Set<string>();

  for (const file of files) {
    const match = FILENAME.exec(file);
    if (match === null) {
      findings.push({
        file,
        rule: 'filename',
        detail: 'must be NNNN_lower_snake_case.sql — the runner orders migrations by that prefix',
      });
      continue;
    }
    const version = match[1] ?? '';
    if (versions.has(version)) {
      findings.push({
        file,
        rule: 'duplicate-version',
        detail: `version ${version} is used twice`,
      });
    }
    versions.add(version);
    findings.push(...checkSql(file, readFileSync(join(directory, file), 'utf8')));
  }
  return findings;
}

function main(): number {
  const index = process.argv.indexOf('--dir');
  const directory = index === -1 ? DEFAULT_DIR : (process.argv[index + 1] ?? DEFAULT_DIR);

  const findings = checkDirectory(directory);
  if (findings.length === 0) {
    console.log('migration check: no findings');
    return 0;
  }
  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.rule}\n  ${finding.detail}`);
  }
  console.error(
    '\nAn intentional exception states its reason in the migration:\n' +
      '  -- migration-check: allow drop-column because the expand half shipped in v0.4.0 and ' +
      'nothing reads it\n' +
      'See QG-08 and INV-17.',
  );
  return 1;
}

process.exitCode = main();
