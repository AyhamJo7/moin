/**
 * Alarms and on-call routing (P15.04.01/.02): threshold shapes per the
 * alerts table (SEV1/SEV2/SEV3, each links a runbook) + routing resolution
 * (SNS → SMS + push + email to the founder; secondary contact when one
 * exists). Pure; Terraform alarms and the SNS plumbing ride separately.
 */

export type Severity = 'SEV1' | 'SEV2' | 'SEV3';

export interface AlarmThreshold {
  readonly metric: string;
  readonly severity: Severity;
  readonly runbook: string;
}

/** Alarm thresholds per the alerts table (PLAN Observability Strategy). */
export function alarmThresholds(): readonly AlarmThreshold[] {
  return [
    { metric: 'outbox.lag', severity: 'SEV1', runbook: 'docs/runbooks/outbox-lag.md' },
    { metric: 'sqs.dlq.depth', severity: 'SEV2', runbook: 'docs/runbooks/dlq-drain.md' },
    {
      metric: 'escalation.unacknowledged',
      severity: 'SEV2',
      runbook: 'docs/runbooks/escalation.md',
    },
    { metric: 'notify.failed', severity: 'SEV2', runbook: 'docs/runbooks/notify-failed.md' },
    {
      metric: 'voice.disclosure.played',
      severity: 'SEV1',
      runbook: 'docs/runbooks/voice-canary.md',
    },
    { metric: 'interactions.orphaned', severity: 'SEV1', runbook: 'docs/runbooks/reconciler.md' },
  ];
}

export type RouteChannel = 'sms' | 'push' | 'email';

export interface OnCallRouting {
  readonly severity: Severity;
  readonly channels: readonly RouteChannel[];
  readonly secondary: boolean;
}

/** Routing: SEV1 pages all channels; secondary contact only when one exists. */
export function routeAlarm(severity: Severity, secondaryExists: boolean): OnCallRouting {
  if (severity === 'SEV1') {
    return { severity, channels: ['sms', 'push', 'email'], secondary: secondaryExists };
  }
  if (severity === 'SEV2') {
    return { severity, channels: ['push', 'email'], secondary: secondaryExists };
  }
  return { severity, channels: ['email'], secondary: false };
}
