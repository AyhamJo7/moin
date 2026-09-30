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
 * ## Why it sweeps tenant by tenant instead of selecting the table
 *
 * The first version of this file ran one plain `SELECT` over `audit_events` with no tenant context,
 * and it was worse than useless. Measured, not reasoned about: as `moin_app` it died on
 * `permission denied` for the allowlist; as `moin_migrator` — which *owns* the tables in production
 * — FORCE ROW LEVEL SECURITY returned **zero rows**, so it printed "every stored argument is a
 * registered key with a reviewed value kind" and exited 0 without inspecting anything. It only
 * appeared to work in its own test, because the test handed it the local bootstrap superuser.
 *
 * That is the same trap migration 0010's header documents for `organisations`, and this check now
 * has the same shape as the daily verifier: enumerate tenants through the reviewed claim function,
 * then read each tenant's rows inside `withTenant` as the ordinary application role. A scan that
 * inspected no rows while tenants exist is a **failure**, not a pass.
 *
 *   node scripts/check-audit-arguments.ts              # uses DATABASE_URL (the application role)
 *   node scripts/check-audit-arguments.ts --url <url>
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool } from '@moin/db/pool';
import { withSystemWork, type ClaimedItem, type TenantClient } from '@moin/db';

/** The value kinds the reviewed registry permits. Widening this set is a QG-09 review. */
const REVIEWED_VALUE_KINDS = ['uuid', 'boolean', 'count'] as const;

/**
 * `count`'s bounds, taken from the writer's own check in `0008_audit_events.sql`:
 * `^(0|[1-9][0-9]{0,8})$` — a non-negative integer of at most nine digits.
 */
const COUNT_MAX = 999_999_999;

/**
 * What the registered kind actually requires of a stored value.
 *
 * Being *registered* used to be treated as sufficient, and it is not: the check read the kind and
 * then only ever tested strings for UUID shape, so `related_id` (kind `uuid`) holding `true`
 * produced **no finding at all** — measured — and `was_confirmed` (kind `boolean`) holding a UUID
 * string passed because the string happened to look like a UUID. Non-string values were skipped
 * outright.
 *
 * This mirrors `app.append_audit_event`'s validation exactly, which is the point: the writer is the
 * control and this is the check that the control held, so a divergence between them is itself the
 * finding.
 *
 * `jsonType` is what `jsonb_typeof` must return. `check` receives the value as text, which is what
 * `#>> '{}'` yields for every scalar.
 */
const KIND_RULES: Readonly<
  Record<string, { readonly jsonType: string; readonly check: (value: string) => boolean }>
> = {
  uuid: { jsonType: 'string', check: (value) => UUID.test(value) },
  // A JSON boolean renders as exactly `true` or `false`; nothing else can reach here.
  boolean: { jsonType: 'boolean', check: (value) => value === 'true' || value === 'false' },
  count: {
    jsonType: 'number',
    check: (value) => /^(0|[1-9][0-9]{0,8})$/u.test(value) && Number(value) <= COUNT_MAX,
  },
};

/** The one string-valued kind. Any other stored string is a leak by construction. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Tenants per claim page, matching the daily verifier's shape. */
const TENANT_PAGE_SIZE = 200;

/**
 * The shape an argument key is allowed to have.
 *
 * `args_sanitized` is only `jsonb_typeof(...) = 'object'` at the column level, so a row that did
 * not come through the writer — this file's whole threat model — can carry any key at all,
 * including `{"hans.mueller@example.test": true}`. The subject of a finding is printed, so an
 * unvalidated key would make this check the very leak it exists to catch.
 */
const SAFE_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
/** Same reasoning for the operation, which is CHECK-constrained but only on rows the writer wrote. */
const SAFE_OPERATION = /^[a-z][a-z0-9_.-]{0,127}$/u;

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

export interface ScanResult {
  readonly findings: readonly Finding[];
  /** Tenants enumerated through the claim function. */
  readonly tenants: number;
  /** Audit events actually inspected. Zero with tenants present means the scan proved nothing. */
  readonly events: number;
  /**
   * Provisioned tenants absent from the register, so outside everything this check inspected.
   *
   * Success is impossible while this is non-zero: the scan cannot vouch for rows it could not
   * reach, and a tenant missing from the register is the one an attacker would choose.
   */
  readonly unregistered: number;
}

/** A printable label for a finding, so a forged key cannot reach the output (INV-12). */
function subjectFor(operation: string, key: string): string {
  const safeOperation = SAFE_OPERATION.test(operation) ? operation : '<unprintable operation>';
  const safeKey = SAFE_KEY.test(key) ? key : '<unprintable key>';
  return `${safeOperation}.${safeKey}`;
}

interface AllowlistRow extends Record<string, unknown> {
  readonly operation: string;
  readonly argument_key: string;
  readonly value_kind: string;
}

interface ArgumentRow extends Record<string, unknown> {
  readonly operation: string;
  readonly key: string;
  readonly value: string;
  readonly kind: string;
  readonly occurrences: string;
}

interface ShapeRow extends Record<string, unknown> {
  readonly operation: string;
  readonly target_kind: string;
  readonly occurrences: string;
}

interface VersionRow extends Record<string, unknown> {
  readonly operation: string;
  readonly key: string;
  readonly value: string;
  readonly occurrences: string;
}

interface ValidationRow extends Record<string, unknown> {
  readonly operation: string;
  readonly key: string;
  readonly kind: string;
  readonly occurrences: string;
}

const ALLOWLIST_QUERY = `
  SELECT operation::text, argument_key::text, value_kind::text FROM audit_argument_allowlist
`;

/**
 * Stored arguments for the current tenant, grouped. The value is returned as text only for the
 * shape rules below; it is never printed, because printing it is the leak this check exists to find.
 */
const ARGUMENT_QUERY = `
  SELECT e.operation::text AS operation,
         arg.key::text AS key,
         arg.value #>> '{}' AS value,
         jsonb_typeof(arg.value)::text AS kind,
         count(*)::text AS occurrences
  FROM audit_events e, LATERAL jsonb_each(e.args_sanitized) AS arg(key, value)
  GROUP BY 1, 2, 3, 4
`;

const VALIDATION_QUERY = `
  SELECT e.operation::text AS operation, v.key::text AS key,
         jsonb_typeof(v.value)::text AS kind, count(*)::text AS occurrences
  FROM audit_events e, LATERAL jsonb_each(e.validation) AS v(key, value)
  WHERE jsonb_typeof(v.value) NOT IN ('boolean', 'number')
  GROUP BY 1, 2, 3
`;

/**
 * The columns the writer constrains with a CHECK but nothing inspects afterwards.
 *
 * `operation`, `target_kind` and the values in `versions` are all caller-supplied and all
 * free-text-capable within their patterns: `hans.mueller-at-example.de` satisfies the `operation`
 * CHECK. They sit in the same 2-year, un-erasable, append-only column family as the arguments, so
 * they get the same structural treatment — a shape that a person's name cannot satisfy.
 */
const SHAPE_QUERY = `
  SELECT e.operation::text AS operation, e.target_kind::text AS target_kind,
         count(*)::text AS occurrences
  FROM audit_events e
  GROUP BY 1, 2
`;

const VERSION_QUERY = `
  SELECT e.operation::text AS operation, ver.key::text AS key,
         ver.value AS value, count(*)::text AS occurrences
  FROM audit_events e, LATERAL jsonb_each_text(e.versions) AS ver(key, value)
  GROUP BY 1, 2, 3
`;

const EVENT_COUNT_QUERY = `SELECT count(*)::text AS n FROM audit_events`;

const CLAIM_QUERY = 'select organisation_id, id from app.claim_audit_chains($1::integer, $2::uuid)';

/**
 * The same independent witness the daily sweep reconciles against.
 *
 * Walking the register tells you about the tenants the register knows. It says nothing about a
 * tenant that is provisioned and *not* in the register — and that tenant's events are exactly the
 * ones nobody is looking at. Measured: with one registered tenant holding a valid event and one
 * provisioned-but-unregistered tenant holding a planted leak, this check enumerated the registered
 * tenants, inspected their events, and reported the leak-bearing tenant not at all.
 */
const UNREGISTERED_QUERY = 'select id from app.unregistered_audit_chains($1::integer)';
/** How many unregistered tenants to name before the finding simply says there are more. */
const UNREGISTERED_SAMPLE = 100;

/** The value kinds `versions` may carry, mirroring the writer's own check in 0008. */
const VERSION_KEYS = new Set(['model', 'prompt', 'policy', 'template']);
const VERSION_VALUE = /^[A-Za-z0-9._:-]{1,64}$/u;
/** `target_kind`'s CHECK pattern. A name cannot satisfy it; a forged row need not respect it. */
const SAFE_TARGET_KIND = /^[a-z][a-z0-9_]{0,63}$/u;

export async function scan(url: string): Promise<ScanResult> {
  const pool = createPool({ connectionString: url, max: 4 });
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let tenants = 0;
  let events = 0;
  let unregistered = 0;

  /** One finding per subject and rule, however many tenants exhibit it. */
  const report = (finding: Finding): void => {
    const key = `${finding.rule}\u0000${finding.subject}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  try {
    // The allowlist is platform reference data and is read once, outside any tenant scope.
    const reviewedKinds = new Set<string>(REVIEWED_VALUE_KINDS);
    const registered = new Map<string, string>();
    const allowlist = await pool.query<AllowlistRow>(ALLOWLIST_QUERY);
    for (const row of allowlist.rows) {
      registered.set(`${row.operation}\u0000${row.argument_key}`, row.value_kind);
      if (!reviewedKinds.has(row.value_kind)) {
        report({
          rule: 'unreviewed-value-kind',
          subject: subjectFor(row.operation, row.argument_key),
          detail:
            `is registered with a value kind that is not one of ${REVIEWED_VALUE_KINDS.join(', ')}. ` +
            'Widening the kinds is how the audit trail becomes a free-text sink, so it is a QG-09 ' +
            'review, not a migration.',
        });
      }
    }

    let after: string | null = null;
    for (;;) {
      let page: readonly ClaimedItem[] = [];
      const result = await withSystemWork(
        pool,
        async (client: TenantClient) => {
          const claimed = await client.query<{ organisation_id: string; id: string }>(CLAIM_QUERY, [
            TENANT_PAGE_SIZE,
            after,
          ]);
          page = claimed.rows.map((row) => ({
            organisationId: row.organisation_id,
            id: row.id,
          }));
          return page;
        },
        async (_item: ClaimedItem, client: TenantClient) => {
          const counted = await client.query<{ n: string }>(EVENT_COUNT_QUERY);
          events += Number(counted.rows[0]?.n ?? '0');

          for (const row of (await client.query<ArgumentRow>(ARGUMENT_QUERY)).rows) {
            const subject = subjectFor(row.operation, row.key);
            const kind = registered.get(`${row.operation}\u0000${row.key}`);
            if (kind === undefined) {
              report({
                rule: 'unregistered-argument-key',
                subject,
                detail:
                  'is stored on at least one event but is not on the argument allowlist, so it did ' +
                  'not come through the reviewed writer.',
              });
              continue;
            }

            const rule = KIND_RULES[kind];
            if (rule === undefined) {
              // Fail closed. A kind nobody wrote a validator for cannot be said to have been
              // checked, and the registry row that introduced it is reported separately.
              report({
                rule: 'unvalidatable-argument-kind',
                subject,
                detail:
                  `is registered with kind "${SAFE_KIND.test(kind) ? kind : 'unprintable'}", for ` +
                  'which this check has no validator, so nothing about its stored values is proven.',
              });
              continue;
            }

            // Wrong JSON type first: a boolean under a `uuid` kind used to be skipped entirely
            // because only strings were examined.
            if (row.kind !== rule.jsonType) {
              report({
                rule: 'argument-kind-mismatch',
                subject,
                detail:
                  `is registered as ${kind}, which requires a JSON ${rule.jsonType}, but a ` +
                  `${SAFE_KIND.test(row.kind) ? row.kind : 'non-scalar'} is stored. The value is ` +
                  'not printed.',
              });
              continue;
            }

            if (rule.check(row.value)) continue;

            // Right type, wrong value. A malformed UUID under a `uuid` kind keeps its existing two
            // rules, because a contact detail there is worth naming as such; every other kind gets
            // the bounds finding.
            if (kind === 'uuid') {
              const contact = CONTACT_PATTERNS.find((c) => c.pattern.test(row.value));
              report({
                rule: contact === undefined ? 'free-text-argument' : 'personal-data-in-argument',
                subject,
                detail:
                  contact === undefined
                    ? 'holds a non-UUID string. The only string-valued argument kind is `uuid`, so ' +
                      'this is an unreviewed value. The value itself is not printed here, because ' +
                      'printing it would be the leak.'
                    : `looks like a ${contact.name} (INV-12). The value is not printed.`,
              });
              continue;
            }
            report({
              rule: 'argument-value-out-of-range',
              subject,
              detail:
                `is registered as ${kind} and its stored value does not satisfy that kind's ` +
                'reviewed bounds (a `count` is a non-negative integer of at most nine digits). The ' +
                'value is not printed.',
            });
          }

          for (const row of (await client.query<ValidationRow>(VALIDATION_QUERY)).rows) {
            report({
              rule: 'non-scalar-validation-value',
              subject: subjectFor(row.operation, row.key),
              detail:
                `is a ${SAFE_KIND.test(row.kind) ? row.kind : 'non-scalar'} value. Validation ` +
                'values are booleans and bounded numbers; anything else can carry text.',
            });
          }

          for (const row of (await client.query<ShapeRow>(SHAPE_QUERY)).rows) {
            if (!SAFE_OPERATION.test(row.operation) || !SAFE_TARGET_KIND.test(row.target_kind)) {
              report({
                rule: 'malformed-operation-or-target-kind',
                subject: subjectFor(row.operation, row.target_kind),
                detail:
                  'does not match the reviewed operation and target-kind shapes, so it did not come ' +
                  'through the writer. These columns are retained as long as the event and can ' +
                  'carry text (INV-12).',
              });
            }
          }

          for (const row of (await client.query<VersionRow>(VERSION_QUERY)).rows) {
            if (!VERSION_KEYS.has(row.key) || !VERSION_VALUE.test(row.value)) {
              report({
                rule: 'unreviewed-version-entry',
                subject: subjectFor(row.operation, row.key),
                detail:
                  'is not one of the reviewed version keys, or its value does not match the ' +
                  'reviewed shape. The value is not printed.',
              });
            }
          }
        },
        (item: ClaimedItem) => {
          report({
            rule: 'tenant-not-scanned',
            subject: item.organisationId,
            detail:
              'could not be scanned, so nothing is proven about its stored arguments. A scan that ' +
              'skipped a tenant is not a clean scan.',
          });
        },
      );

      tenants += result.claimed;
      const last = page.at(-1);
      if (result.claimed < TENANT_PAGE_SIZE || last === undefined) break;
      after = last.organisationId;
    }

    // Reconciliation, against the same global witness the daily sweep uses. This runs after the
    // sweep and before any success is declared, because the question it answers — did I look at
    // everything I should have — cannot be answered by the worklist that was drained.
    const missing = await pool.query<{ id: string }>(UNREGISTERED_QUERY, [UNREGISTERED_SAMPLE]);
    for (const row of missing.rows) {
      unregistered += 1;
      report({
        rule: 'unregistered-tenant-not-scanned',
        // An organisation id is an opaque business identifier, not personal data (INV-12).
        subject: row.id,
        detail:
          'is provisioned but has no audit chain register row, so this check never reached its ' +
          'events and nothing is proven about the arguments stored under it.',
      });
    }
  } finally {
    await pool.end();
  }

  return { findings, tenants, events, unregistered };
}

/** `jsonb_typeof` output, which is a fixed vocabulary — but the row is data, so it is checked. */
const SAFE_KIND = /^[a-z]{1,16}$/u;

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
  let result: ScanResult;
  try {
    result = await scan(urlFromArgv());
  } catch (error) {
    console.error(`audit argument scan could not run: ${String(error)}`);
    return 1;
  }

  // Coverage before content, and printed **before** any findings rather than instead of them: a
  // run can have both, and the gap is the more important of the two. Reporting findings and
  // returning early hid the coverage message exactly when there was something to hide.
  if (result.unregistered > 0) {
    console.error(
      `audit argument scan could not reach ${String(result.unregistered)} provisioned tenant(s): ` +
        'they have no audit chain register row. Nothing is proven about the arguments stored under ' +
        'them — see docs/runbooks/audit-chain-break.md.',
    );
  }

  if (result.findings.length > 0) {
    console.error('Audit argument findings (INV-10, INV-12):');
    for (const finding of result.findings) {
      console.error(`  [${finding.rule}] ${finding.subject}`);
      console.error(`    ${finding.detail}`);
    }
    console.error('');
  }

  if (result.unregistered > 0 || result.findings.length > 0) return 1;

  // A scan that inspected nothing is not a clean scan. This is the failure the first version of
  // this file shipped: FORCE RLS returned zero rows and it printed a reassuring sentence.
  if (result.tenants === 0) {
    console.error(
      'audit argument scan enumerated no tenants, so it proved nothing. Either the register is ' +
        'empty or the claim function is unreadable by this role — see docs/runbooks/audit-chain-break.md.',
    );
    return 1;
  }
  if (result.events === 0) {
    console.error(
      `audit argument scan inspected 0 events across ${String(result.tenants)} tenant(s). On a ` +
        'database with an audit trail this means the rows are not visible to this role, which is ' +
        'exactly the vacuous pass this check is written to refuse.',
    );
    return 1;
  }

  console.log(
    `audit arguments: ${String(result.events)} event(s) across ${String(result.tenants)} tenant(s), ` +
      'with every provisioned tenant registered; every stored argument is a registered key whose ' +
      'value satisfies its reviewed kind.',
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
