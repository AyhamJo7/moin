// @moin/ai — the model gateway port, provider selection and the latency measurement harness.
//
// Declared in P02.03 so the workspace graph and the module-boundary rules were complete. P04.03
// fills in the port and the harness: the port so that a provider decision that cannot be made yet
// (EXT-12, DG-14) costs a configuration change rather than a rewrite, and the harness so that the
// latency figures P04 is judged on have a definition before they have values.
//
// P10.01 adds the first provider adapter (OpenAI EU). The fake gateway stays:
// every test of a dialogue, tool call or fallback needs a model that is
// deterministic, instant and free.

export type {
  ModelTier,
  GatewayMessage,
  GatewayRequest,
  GatewayUsage,
  GatewaySuccess,
  GatewayFailure,
  GatewayFailureReason,
  GatewayResult,
  ModelGateway,
} from './gateway/port.ts';

export { createFakeGateway } from './gateway/fake.ts';
export type { FakeGatewayOptions, ScriptedAnswer, ScriptedOutcome } from './gateway/fake.ts';
export { createOpenAiAdapter, hashCallerId } from './gateway/openai.ts';
export type { OpenAiAdapterConfig } from './gateway/openai.ts';
export { SCHEMA_REJECTIONS, toProviderSchema } from './gateway/structured.ts';
export { buildNluMessages, containsPii, redactProposedOutput } from './gateway/context.ts';
export type { NluContext } from './gateway/context.ts';
export {
  MAX_INPUT_TOKENS_PER_CALL,
  PURPOSE_POLICIES,
  resetBreakers,
  withResilience,
} from './gateway/resilience.ts';
export type { GatewayPurpose, PurposePolicy, ResilienceOptions } from './gateway/resilience.ts';
export { checkEvalFreshness, releaseManifest, versionSet } from './gateway/registry.ts';
export type { ReleaseManifest, VersionRef, VersionSetSources } from './gateway/registry.ts';
export { decide } from './gateway/policy.ts';
export type {
  PolicyAction,
  PolicyContext,
  PolicyDecision,
  PolicyNlu,
  ReasonCode,
} from './gateway/policy.ts';
export {
  COMMITMENT_WITHOUT_TOKEN,
  defineTool,
  guardedExecute,
  reconcileUnknown,
} from './gateway/tools.ts';
export type {
  GuardCall,
  GuardOutcome,
  GuardPorts,
  GuardRejection,
  ResultToken,
  ToolChannel,
  ToolDef,
} from './gateway/tools.ts';
export {
  VOICE_TOOLS,
  captureCallback,
  createAppointmentRequest,
  createLead,
  endCall,
  escalate,
} from './gateway/voice-tools.ts';
export {
  bindTemplate,
  hashTemplate,
  loadTemplate,
  RESTAURANT_V1,
  SENSITIVE_DENYLIST,
} from './gateway/templates.ts';
export type {
  BoundTemplate,
  TemplateIntent,
  TemplatePackage,
  TenantOverrides,
} from './gateway/templates.ts';
export { evaluateRules, RESTAURANT_DEFAULT_RULES, validateRule } from './gateway/rules.ts';
export type {
  OwnerRule,
  RuleActions,
  RuleChannel,
  RuleFacts,
  RuleTrigger,
  RuleUrgency,
  WorkflowRun,
} from './gateway/rules.ts';
export {
  detectEmergency,
  emergencyFromNlu,
  HANDWERK_CATEGORIES,
  RESTAURANT_CATEGORIES,
  SCRIPTS_REVIEWED,
} from './gateway/lifesafety.ts';
export type { EmergencyCategory, EmergencyHit } from './gateway/lifesafety.ts';
export {
  ANOMALY_BLOCKED,
  delimitUntrusted,
  detectAnomaly,
  SYSTEM_GUARD_RAIL,
  toolAllowedByTemplate,
} from './gateway/injection.ts';
export type { AnomalyClass, AnomalyHit } from './gateway/injection.ts';
export { checkQualityGate, scoreAnswers, wilsonLow } from './gateway/evalharness.ts';
export type {
  EvalCase,
  EvalDataset,
  EvalReport,
  EvalSuite,
  IntentMetric,
  QualityGate,
  ScoredCase,
} from './gateway/evalharness.ts';

export {
  nearestRankPercentile,
  summarise,
  summariseAll,
  isSufficientlyPowered,
  toMarkdownRow,
  MARKDOWN_HEADER,
  REQUIRED_MODEL_SAMPLES,
} from './measurement/latency.ts';
export type { LatencySample, LatencySummary } from './measurement/latency.ts';
