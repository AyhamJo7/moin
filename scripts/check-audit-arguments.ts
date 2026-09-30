/**
 * The audit argument scanner (P06.10.07, INV-10, INV-12).
 *
 * ## Why a scanner and not only a writer check
 *
 * `app.append_audit_event` already refuses an argument key that is not registered, and refuses a
 * value whose shape does not match its registered kind. That is the control; this is the check that
 * the control held. The two are not the same thing, and the difference is the whole reason this file
 * exists:
 *
 * - the registry itself can be widened by a later migration, and "add a `text` value kind" is a
 *   one-line change that reads as harmless and quietly turns the audit trail into a free-text sink;
 * - rows can arrive by a path that is not the writer — a restore, a repair script, a future bulk
 *   import — and the writer cannot check what it did not write;
 * - a `uuid`-kind argument whose value is a *name* would be rejected, but nobody had yet asserted
 *   that no such value is present in the rows we actually have.
 *
 * ## The structural rule is the strong one
 *
 * Pattern-matching for emails and phone numbers finds the obvious leaks and misses a surname. The
 * rule that actually holds is structural: the only string-valued argument kind the reviewed registry
 * permits is `uuid`, so **any stored argument string that is not a UUID is a leak**, whatever it
 * contains. A name, a street, a free-text note and a raw request body all fail that rule without
 * anyone having to predict their shape. The patterns below are kept as well, because they name the
 * finding usefully when it is a contact detail.
 *
 *   node scripts/check-audit-arguments.ts              # uses DATABASE_URL
 *   node scripts/check-audit-arguments.ts --url <url>
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool } from '@moin/db/pool';

/** The value kinds the reviewed registry permits. Widening this set is a QG-09 review. */
const REVIEWED_VALUE_KINDS = ['uuid', 'boolean', 'count'] as const;

/** The one string-valued kind. Any other stored string is a leak by construction. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Named so a finding reads usefully when the leak is a contact detail. */
const CONTACT_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'email address', pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu },
  { name: 'phone number', pattern: /^\+?[0-9][0-9 ()/-]{8,}$/u },
  { name: 'IBAN', pattern: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/u },
];

export interface Finding {
  readonly rule: string;
  readonly subject: string;
  readonly detail: string;
}

interface AllowlistRow {
  readonly operation: string;
  readonly argument_key: string;
  readonly value_kind: string;
}

interface ArgumentRow {
  readonly operation: string;
  readonly key: string;
  readonly value: string;
  readonly kind: string;
  readonly registered_kind: string | null;
  readonly occurrences: string;
}

interface ValidationRow {
  readonly operation: string;
  readonly key: string;
  readonly kind: string;
  readonly occurrences: string;
}

const ALLOWLIST_QUERY = `
  SELECT operation::text, argument_key::text, value_kind::text FROM audit_argument_allowlist
`;

/**
 * Stored arguments, grouped. The value is returned as text only for the shape rules below; it is
 * never printed, because printing it is the leak this check exists to find.
 */
const ARGUMENT_QUERY = `
  SELECT e.operation::text AS operation,
         arg.key::text AS key,
         arg.value #>> '{}' AS value,
         jsonb_typeof(arg.value)::text AS kind,
         (SELECT a.value_kind::text FROM audit_argument_allowlist a
           WHERE a.operation = e.operation AND a.argument_key = arg.key) AS registered_kind,
         count(*)::text AS occurrences
  FROM audit_events e, LATERAL jsonb_each(e.args_sanitized) AS arg(key, value)
  GROUP BY 1, 2, 3, 4, 5
`;

const VALIDATION_QUERY = `
  SELECT e.operation::text AS operation, v.key::text AS key,
         jsonb_typeof(v.value)::text AS kind, count(*)::text AS occurrences
  FROM audit_events e, LATERAL jsonb_each(e.validation) AS v(key, value)
  WHERE jsonb_typeof(v.value) NOT IN ('boolean', 'number')
  GROUP BY 1, 2, 3
`;

export async function scan(url: string): Promise<Finding[]> {
  const pool = createPool({ connectionString: url, max: 1 });
  const findings: Finding[] = [];
  try {
    const reviewed = new Set<string>(REVIEWED_VALUE_KINDS);
    for (const row of (await pool.query<AllowlistRow>(ALLOWLIST_QUERY)).rows) {
      if (!reviewed.has(row.value_kind)) {
        findings.push({
          rule: 'unreviewed-value-kind',
          subject: `${row.operation}.${row.argument_key}`,
          detail:
            `is registered with value kind "${row.value_kind}", which is not one of ` +
            `${REVIEWED_VALUE_KINDS.join(', ')}. Widening the kinds is how the audit trail ` +
            'becomes a free-text sink, so it is a QG-09 review, not a migration.',
        });
      }
    }

    for (const row of (await pool.query<ArgumentRow>(ARGUMENT_QUERY)).rows) {
      const subject = `${row.operation}.${row.key}`;
      if (row.registered_kind === null) {
        findings.push({
          rule: 'unregistered-argument-key',
          subject,
          detail:
            `is stored on ${row.occurrences} event(s) but is not on the argument allowlist, so it ` +
            'did not come through the reviewed writer.',
        });
        continue;
      }
      if (row.kind !== 'string') continue;
      // The only string kind the registry permits is `uuid`. Anything else is a value nobody
      // reviewed, whatever it happens to contain.
      if (!UUID.test(row.value)) {
        const contact = CONTACT_PATTERNS.find((candidate) => candidate.pattern.test(row.value));
        findings.push({
          rule: contact === undefined ? 'free-text-argument' : 'personal-data-in-argument',
          subject,
          detail:
            contact === undefined
              ? `holds a non-UUID string on ${row.occurrences} event(s). The only string-valued ` +
                'argument kind is `uuid`, so this is an unreviewed value. The value itself is not ' +
                'printed here, because printing it would be the leak.'
              : `looks like a ${contact.name} on ${row.occurrences} event(s) (INV-12). The value ` +
                'is not printed.',
        });
      }
    }

    for (const row of (await pool.query<ValidationRow>(VALIDATION_QUERY)).rows) {
      findings.push({
        rule: 'non-scalar-validation-value',
        subject: `${row.operation}.${row.key}`,
        detail:
          `is a ${row.kind} on ${row.occurrences} event(s). Validation values are booleans and ` +
          'bounded numbers; anything else can carry text.',
      });
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
      'no database to scan: pass --url, or set DATABASE_URL. This check reads the rows that were ' +
        'actually written, which is the question the writer cannot answer about itself.',
    );
  }
  return url;
}

async function main(): Promise<number> {
  let findings: Finding[];
  try {
    findings = await scan(urlFromArgv());
  } catch (error) {
    console.error(`audit argument scan could not run: ${String(error)}`);
    return 1;
  }

  if (findings.length === 0) {
    console.log(
      'audit arguments: every stored argument is a registered key with a reviewed value kind.',
    );
    return 0;
  }

  console.error('Audit argument findings (INV-10, INV-12):');
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
