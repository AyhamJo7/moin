/**
 * Metrics catalogue (P15.02.01): stable metric names per the Observability
 * Strategy — the names are stable API. `isKnownMetric` guards emission
 * sites; `dashboardMetrics` pins each of the six dashboards to its metrics.
 * Pure; emission and Terraform dashboards ride separately.
 */

/** Every metric name in the catalogue. */
export const METRIC_CATALOGUE: readonly string[] = [
  // Platform
  'http.requests',
  'http.latency',
  'errors.5xx',
  'sse.connections',
  'db.pool.wait',
  'db.query.latency',
  'valkey.errors',
  // Voice
  'voice.calls.inbound',
  'voice.calls.answered_by_ai',
  'voice.disclosure.played',
  'voice.turn.latency',
  'voice.fallback.layer',
  'voice.calls.abandoned',
  // AI
  'ai.calls',
  'ai.latency',
  'ai.timeouts',
  'ai.schema.rejections',
  'ai.circuit.open',
  'ai.wording.rejected',
  'ai.cost_micros',
  'ai.tokens',
  // Tools / safety
  'tools.proposed',
  'tools.rejected',
  'tools.executed',
  'tools.unknown_state',
  'security.anomaly.blocked',
  'emergency.script.triggered',
  'commitment.without_token',
  // Business
  'interactions.created',
  'interactions.handled_automatically',
  'tasks.created',
  'tasks.time_to_first_action',
  'leads.created',
  'faq.resolved',
  'callbacks.captured',
  'interactions.orphaned',
  'owner.feedback',
  // Queues
  'sqs.age.oldest',
  'sqs.depth',
  'sqs.dlq.depth',
  'jobs.failures',
  'jobs.duration',
  'outbox.lag',
  // Notifications
  'notify.sent',
  'notify.failed',
  'notify.latency',
  'escalation.unacknowledged',
  // Knowledge (P09 eval/report metrics)
  'knowledge.suspended',
  'knowledge.reverify.overdue',
];

const CATALOGUE = new Set(METRIC_CATALOGUE);

/** True when the name is a catalogue metric (stable API). */
export function isKnownMetric(name: string): boolean {
  return CATALOGUE.has(name);
}

/** Dashboard index (1–6) → its catalogue metrics. */
export function dashboardMetrics(dashboard: number): readonly string[] {
  if (dashboard === 1) {
    return [
      'voice.calls.inbound',
      'voice.calls.answered_by_ai',
      'voice.disclosure.played',
      'voice.turn.latency',
      'voice.fallback.layer',
    ];
  }
  if (dashboard === 2) {
    return ['ai.calls', 'ai.latency', 'ai.timeouts', 'ai.schema.rejections', 'ai.cost_micros'];
  }
  if (dashboard === 3) {
    return [
      'interactions.created',
      'interactions.handled_automatically',
      'interactions.orphaned',
      'owner.feedback',
      'faq.resolved',
    ];
  }
  if (dashboard === 4) {
    return [
      'http.requests',
      'http.latency',
      'db.pool.wait',
      'sqs.depth',
      'sqs.age.oldest',
      'outbox.lag',
    ];
  }
  if (dashboard === 5) {
    return ['ai.cost_micros', 'notify.sent'];
  }
  if (dashboard === 6) {
    return ['security.anomaly.blocked', 'auth.login.failures', 'webhook.signature.invalid'].filter(
      (m) => CATALOGUE.has(m),
    );
  }
  throw new RangeError('dashboard must be 1..6');
}
