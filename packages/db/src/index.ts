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
  CORRELATION_SETTING,
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
  ActiveMembership,
  RequestContext,
  RotationReason,
  ResetReason,
} from './identity-store.ts';
export {
  VersionConflictError,
  addContactMethod,
  createContact,
  listContactMethods,
  listContacts,
  normaliseMethodValue,
  removeContactMethod,
  updateContact,
  verifyContactMethod,
} from './contacts.ts';
export type {
  Contact,
  ContactMethod,
  ContactMethodKind,
  MethodVerification,
  VerifiedVia,
} from './contacts.ts';
export { resolveCaller, resolveEmail, resolveExternalId } from './resolution.ts';
export type { ResolutionRule, ResolutionVerdict } from './resolution.ts';
export {
  advanceCallStatus,
  getOutcome,
  ingestCall,
  recordCallEvent,
  recordOutcome,
  startConversation,
} from './conversations.ts';
export type {
  Call,
  CallEventKind,
  CallStatus,
  Conversation,
  ConversationChannel,
  ConversationStatus,
  OutcomeInput,
  OutcomeResult,
} from './conversations.ts';
export {
  assignTask,
  completeTask,
  createTask,
  listOpenTasks,
  reopenTask,
  setTaskStatus,
  snoozeTask,
} from './tasks.ts';
export type { NewTask, Task, TaskPriority, TaskStatus, TaskType } from './tasks.ts';
export { createLead, getLead, listLeads, setLeadStatus } from './leads.ts';
export type { Lead, LeadStatus, LostReason } from './leads.ts';
export {
  confirmRequest,
  convertToBooking,
  createRequest,
  declineRequest,
  getRequest,
  listRequests,
} from './appointment-requests.ts';
export type {
  AppointmentRequest,
  InformedVia,
  NewRequest,
  RequestKind,
  RequestStatus,
} from './appointment-requests.ts';
export {
  checkFactSchemaShape,
  createNote,
  deleteNote,
  listNotes,
  registerFactSchema,
  validateFacts,
} from './notes-facts.ts';
export type { FactSchema, Note, NoteParent } from './notes-facts.ts';
export {
  decideApproval,
  finishRun,
  invokeTool,
  purgeCandidates,
  recordAction,
  reportInvocation,
  requestApproval,
  startRun,
} from './governance.ts';
export type {
  ActionKind,
  AiAction,
  ApprovalStatus,
  HumanApproval,
  InvocationState,
  ProposalKind,
  RunStatus,
  ToolInvocation,
  WorkflowRun,
} from './governance.ts';
