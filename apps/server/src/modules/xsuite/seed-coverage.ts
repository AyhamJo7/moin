/**
 * Which FORCE-RLS tables the two-tenant harness actually seeds (P06.13.01).
 *
 * The harness seeds eight tenant tables for tenants A and B. The live catalog holds 55, and
 * "every table" was true only when there were nine. This pins the honest picture and makes it
 * drift-proof: every FORCE-RLS table is either seeded here or carries a registered reason, so a
 * table added by a later migration fails the suite until it is seeded or explained.
 *
 * The reasons below are factual, not a claim of isolation: they name the module integration
 * tests that touch the table, or say that none does. Moving a table from the registry to the
 * seeded list is the work that closes P06.13.01; the write matrix of the RLS catalog gap fix
 * (the tenant-write-matrix integration test) is the intended source of that seeding.
 */

/** Tables for which `seed.ts` inserts a row for tenant A and one for tenant B. */
export const SEEDED_TABLES: readonly string[] = [
  'organisations',
  'locations',
  'memberships',
  'invitations',
  'owner_invitation_requests',
  'support_access_grants',
  'tasks',
  'tenant_setup',
];

/** FORCE-RLS tables the harness does not seed, each with the reason it does not. */
export const UNSEEDED_TABLES: Readonly<Record<string, string>> = {
  ai_actions: 'not seeded here; module tests that touch it: governance.integration.test.ts',
  appointment_requests:
    'not seeded here; module tests that touch it: appointment-requests.integration.test.ts',
  audit_events:
    'not seeded here; module tests that touch it: audit-verification.integration.test.ts, audit.integration.test.ts, callback-intake.integration.test.ts',
  audit_heads:
    'not seeded here; module tests that touch it: audit-verification.integration.test.ts, audit.integration.test.ts, provisioning.integration.test.ts',
  booking_confirms:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  business_domains: 'not seeded here; module tests that touch it: import.integration.test.ts',
  business_profile: 'not seeded here; module tests that touch it: profile.integration.test.ts',
  call_events:
    'not seeded here; module tests that touch it: callback-intake.integration.test.ts, callback-today.integration.test.ts, conversations.integration.test.ts',
  callback_acceptances:
    'not seeded here; module tests that touch it: callback-intake.integration.test.ts, callback-today.integration.test.ts, owner-completes-callback.integration.test.ts',
  calls:
    'not seeded here; module tests that touch it: audit-verification.integration.test.ts, callback-intake.integration.test.ts, callback-today.integration.test.ts',
  contact_merges: 'not seeded here; module tests that touch it: merge.integration.test.ts',
  contact_methods: 'not seeded here; module tests that touch it: resolution.integration.test.ts',
  contacts:
    'not seeded here; module tests that touch it: concurrency.integration.test.ts, contacts.integration.test.ts, conversations.integration.test.ts',
  conversations:
    'not seeded here; module tests that touch it: callback-intake.integration.test.ts, concurrency.integration.test.ts, conversations.integration.test.ts',
  duplicate_candidates:
    'not seeded here; module tests that touch it: merge.integration.test.ts, resolution.integration.test.ts',
  escalation_acks:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  escalation_chains:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  fact_schemas:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  faq_cards:
    'not seeded here; module tests that touch it: channels.integration.test.ts, conflicts.integration.test.ts, faq.integration.test.ts',
  human_approvals: 'not seeded here; module tests that touch it: governance.integration.test.ts',
  idempotency_keys:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  interaction_links:
    'not seeded here; module tests that touch it: merge.integration.test.ts, resolution.integration.test.ts',
  interaction_outcomes:
    'not seeded here; module tests that touch it: callback-intake.integration.test.ts, callback-today.integration.test.ts, conversations.integration.test.ts',
  job_runs:
    'not seeded here; module tests that touch it: job-consumer.integration.test.ts, job-execution.integration.test.ts, worker-process.integration.test.ts',
  knowledge_approvals:
    'not seeded here; module tests that touch it: approval-backfill.integration.test.ts, approval.integration.test.ts, knowledge.integration.test.ts',
  knowledge_conflicts: 'not seeded here; module tests that touch it: conflicts.integration.test.ts',
  knowledge_import_runs: 'not seeded here; module tests that touch it: import.integration.test.ts',
  knowledge_items:
    'not seeded here; module tests that touch it: approval-backfill.integration.test.ts, channels.integration.test.ts, knowledge.integration.test.ts',
  knowledge_passages:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  knowledge_reverify_queue:
    'not seeded here; module tests that touch it: staleness.integration.test.ts',
  knowledge_versions:
    'not seeded here; module tests that touch it: approval-backfill.integration.test.ts, channels.integration.test.ts, import.integration.test.ts',
  lead_tasks: 'not seeded here; module tests that touch it: leads.integration.test.ts',
  leads:
    'not seeded here; module tests that touch it: concurrency.integration.test.ts, leads.integration.test.ts, notes-facts.integration.test.ts',
  messages: 'not seeded here; module tests that touch it: job-consumer.integration.test.ts',
  notes:
    'not seeded here; module tests that touch it: appointment-requests.integration.test.ts, contacts.integration.test.ts, notes-facts.integration.test.ts',
  notification_deliveries:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  notification_prefs:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  notifications:
    'not seeded here; module tests that touch it: deliveries.integration.test.ts, notifications.integration.test.ts',
  opening_exceptions:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  opening_rules: 'not seeded here; module tests that touch it: conflicts.integration.test.ts',
  outbox:
    'not seeded here; module tests that touch it: job-consumer.integration.test.ts, outbox.integration.test.ts, worker-process.integration.test.ts',
  slot_holds:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  sse_events: 'not seeded here; module tests that touch it: sse.integration.test.ts',
  tenant_flag_overrides:
    'not seeded here; no module integration test touches it, so only the RLS catalog policy check covers it',
  timers: 'not seeded here; module tests that touch it: timers.integration.test.ts',
  tool_invocations: 'not seeded here; module tests that touch it: governance.integration.test.ts',
  workflow_runs: 'not seeded here; module tests that touch it: governance.integration.test.ts',
};

export interface SeedCoverage {
  readonly forced: number;
  readonly seeded: number;
  readonly registered: number;
  readonly summary: string;
  readonly newWithoutSeedOrReason: readonly string[];
  readonly seededButNotForced: readonly string[];
  readonly registeredButNotForced: readonly string[];
  readonly seededAndRegistered: readonly string[];
  readonly emptyReason: readonly string[];
}

/** Compares the live FORCE-RLS table names with the seeded list and the registry. */
export function checkSeedCoverage(
  forced: readonly string[],
  seeded: readonly string[] = SEEDED_TABLES,
  registry: Readonly<Record<string, string>> = UNSEEDED_TABLES,
): SeedCoverage {
  const live = new Set(forced);
  const seededSet = new Set(seeded);
  const registered = Object.keys(registry);
  return {
    forced: live.size,
    seeded: seededSet.size,
    registered: registered.length,
    summary: `${String(seededSet.size)} of ${String(live.size)} FORCE-RLS tables seeded, ${String(registered.length)} registered with a reason`,
    newWithoutSeedOrReason: [...live].filter((t) => !seededSet.has(t) && !(t in registry)).sort(),
    seededButNotForced: [...seededSet].filter((t) => !live.has(t)).sort(),
    registeredButNotForced: registered.filter((t) => !live.has(t)).sort(),
    seededAndRegistered: registered.filter((t) => seededSet.has(t)).sort(),
    emptyReason: registered.filter((t) => (registry[t] ?? '').trim() === '').sort(),
  };
}

/** Throws unless every live FORCE-RLS table is accounted for exactly once. */
export function assertSeedCoverage(coverage: SeedCoverage): void {
  const problems: string[] = [];
  if (coverage.newWithoutSeedOrReason.length > 0) {
    problems.push(
      `no seed and no registered reason: ${coverage.newWithoutSeedOrReason.join(', ')}`,
    );
  }
  if (coverage.seededButNotForced.length > 0) {
    problems.push(`seeded but not FORCE-RLS tables: ${coverage.seededButNotForced.join(', ')}`);
  }
  if (coverage.registeredButNotForced.length > 0) {
    problems.push(
      `registered but not FORCE-RLS tables: ${coverage.registeredButNotForced.join(', ')}`,
    );
  }
  if (coverage.seededAndRegistered.length > 0) {
    problems.push(
      `both seeded and registered as unseeded: ${coverage.seededAndRegistered.join(', ')}`,
    );
  }
  if (coverage.emptyReason.length > 0)
    problems.push(`registered without a reason: ${coverage.emptyReason.join(', ')}`);
  if (problems.length > 0)
    throw new Error(`two-tenant seed coverage drifted: ${problems.join('; ')}`);
}
