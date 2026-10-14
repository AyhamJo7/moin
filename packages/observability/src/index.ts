// @moin/observability — OpenTelemetry setup, the Pino logger with its redaction allowlist, and
// metric helpers. The logger and the INV-12 allowlist land in P02.03; tracing and metrics in P15.01.

export { createLogger, withRequestContext, currentRequestContext } from './logger.ts';
export type { Logger, LoggerConfig, RequestContext } from './logger.ts';
export { redactToAllowlist, ALLOWED_FIELDS, REDACTED } from './redaction.ts';
export { METRIC_CATALOGUE, isKnownMetric, dashboardMetrics } from './metrics.ts';
export { alarmThresholds, routeAlarm } from './alarms.ts';
export type { AlarmThreshold, OnCallRouting, RouteChannel, Severity } from './alarms.ts';
export {
  canaryRunOk,
  callCanaryAlarms,
  CANARY_TURN_LATENCY_MS,
  CALL_CANARY_FAIL_LIMIT,
} from './call-canary.ts';
export type { CanaryRun } from './call-canary.ts';
