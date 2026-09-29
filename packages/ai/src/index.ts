// @moin/ai — the model gateway port, provider selection and the latency measurement harness.
//
// Declared in P02.03 so the workspace graph and the module-boundary rules were complete. P04.03
// fills in the port and the harness: the port so that a provider decision that cannot be made yet
// (EXT-12, DG-14) costs a configuration change rather than a rewrite, and the harness so that the
// latency figures P04 is judged on have a definition before they have values.
//
// No provider adapter lives here yet. That is P10, and building one against an account that does
// not exist would produce code nobody could verify.

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
