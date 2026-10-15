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
export { orderTimeline, eventIsRedacted } from './debug-timeline.ts';
export type { TimelineEvent, TimelineKind } from './debug-timeline.ts';
export { opsAllowed, opsAudit } from './ops-cli.ts';
export type { OpsAudit, OpsCommand } from './ops-cli.ts';
export { logIsValid, breachPackComplete } from './incident.ts';
export type { IncidentLog, IncidentSeverity, BreachPack } from './incident.ts';
export { aggregateKpis } from './kpi.ts';
export type { KpiCounts, KpiDashboard } from './kpi.ts';
export { tenantCostMicros, attributionTotal, costAnomaly } from './cost-attribution.ts';
export type { TenantUsage, CostRates } from './cost-attribution.ts';
export { disclosureRecorded, traceLinks } from './disclosure.ts';
export type { DisclosureRecord, TraceLink } from './disclosure.ts';
export { businessInScope, intentDenied, scopePasses, SCOPE_REFUSAL } from './scope-guard.ts';
export {
  turnFieldsValid,
  turnLogAllowed,
  FREE_TEXT_MAX,
  TURN_LOG_TTL_DAYS,
} from './turnlog-policy.ts';
export type { TurnFields, TurnLogOptIn } from './turnlog-policy.ts';
export { prodShapeValid, prodWriteAllowed } from './prod-env.ts';
export type { Environment, ProdShape } from './prod-env.ts';
export { hardeningComplete, hardeningOpen } from './hardening.ts';
export type { HardeningCheck } from './hardening.ts';
export { wafRules, rateLimits, limitPresent } from './waf.ts';
export type { WafRule, WafRuleKind, RateLimit } from './waf.ts';
export { rotationDue, breakGlassAllowed, ROTATION_DAYS } from './secrets.ts';
export type { BreakGlass } from './secrets.ts';
export {
  backupConfigValid,
  restoreTargetValid,
  PITR_DAYS,
  BACKUP_RETENTION_DAYS,
} from './backup.ts';
export type { BackupConfig } from './backup.ts';
