// @moin/db — reviewed SQL migrations, Drizzle table definitions, roles and RLS SQL, the tenant
// wrapper and seeds. P02.03 added only the readiness probe, because /readyz must answer for the
// database before any schema exists; P06 adds the migrations, FORCE RLS and the tenant wrapper.
//
// `withTenant` is the only sanctioned way to reach tenant data, and `@moin/db/pool` is a separate
// entry point so that a boundary rule can see — and forbid — anyone reaching around it.

export { postgresReadiness, IDENTITY_POOL_ASSERTION } from './readiness.ts';
export {
  withTenant,
  withSystemWork,
  currentTenant,
  tenantLogFields,
  TenantContextError,
  TENANT_SETTING,
} from './tenant.ts';
export type {
  TenantContext,
  TenantClient,
  WithTenantOptions,
  ClaimedItem,
  SystemWorkResult,
} from './tenant.ts';
export type { ReadinessCheck, ReadinessResult, PostgresReadinessOptions } from './readiness.ts';
export { appendAuditEvent, listAuditEvents, verifyAuditChain } from './audit.ts';
export type { AuditChainResult, AuditEventInput, AuditQuery, AuditEvent } from './audit.ts';
export { verifyAuditChains, isSound } from './audit-verification.ts';
export type {
  AuditChainBreak,
  AuditChainFailure,
  AuditVerificationReport,
  VerifyAuditChainsOptions,
} from './audit-verification.ts';
export { createIdentityStore } from './identity-store.ts';
export type {
  IdentityStore,
  NewAuthTransaction,
  ConsumedAuthTransaction,
  NewSession,
  SessionGrant,
  ResolvedSession,
  RotationReason,
} from './identity-store.ts';
