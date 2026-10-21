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
  finaliseInteraction,
  orphanConversations,
  orphanSeverity,
  reconcileOrphans,
} from './finaliser.ts';
export type {
  FinaliseVerdict,
  OrphanFinalised,
  OrphanSeverity,
  ReconcileOrphansOptions,
  ReconcileReport,
} from './finaliser.ts';
export { ORPHAN_AFTER_MINUTES, RECONCILE_PAGE_SIZE } from './finaliser.ts';
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
  VersionConflictError as TaskVersionConflictError,
  assignTask,
  completeTask,
  createTask,
  getTask,
  listOpenTasks,
  listTodayTasks,
  lockTask,
  reopenTask,
  setTaskStatus,
  snoozeTask,
} from './tasks.ts';
export type { NewTask, Task, TaskPriority, TaskStatus, TaskType, TodayTaskRow } from './tasks.ts';
export { CallbackConflictError, captureCallbackRequest } from './callback-intake.ts';
export type { CallbackConflict, CallbackRequest, CapturedCallback } from './callback-intake.ts';
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
export { isVersionConflict, versionConflictProblem } from './version-conflict.ts';
export type { VersionConflictProblem, VersionConflictRepresentation } from './version-conflict.ts';
export {
  VERSION_CONFLICT_PROBLEM_TYPE,
  VERSION_CONFLICT_STATUS,
  VERSION_CONFLICT_TITLE,
} from './version-conflict.ts';
export {
  applyMerge,
  suggestAiSimilarity,
  suggestEmailLocal,
  suggestNamePostal,
  unmerge,
} from './merge.ts';
export type { CandidateSignal, DuplicateCandidate, MergeRecord, UnmergeRecord } from './merge.ts';
export { searchTenant } from './search.ts';
export type { SearchHit, SearchPage, SearchScope } from './search.ts';
export {
  approveKnowledgeVersion,
  createKnowledgeItem,
  editKnowledgeItem,
  getLiveVersion,
  retireKnowledgeItem,
  reverifyDaysForCategory,
} from './knowledge.ts';
export type {
  KnowledgeItem,
  KnowledgeMetadata,
  KnowledgeSensitivity,
  KnowledgeSource,
  KnowledgeState,
  KnowledgeVersion,
} from './knowledge.ts';
export { getProfile, renderAnswer, upsertProfile } from './profile.ts';
export type {
  AddressFacts,
  BodyFacts,
  BusinessNameFacts,
  BusinessProfile,
  PriceRangesFacts,
  ProfileCategory,
  ProfileFacts,
  ServiceAreaFacts,
  ServicesFacts,
} from './profile.ts';
export {
  addException,
  describeWeek,
  hoursOnDate,
  isOpenAt,
  loadHours,
  nextOpening,
  setWeeklyRules,
} from './hours.ts';
export type {
  DayHours,
  ExceptionInput,
  ExceptionKind,
  HoursSnapshot,
  OpeningInterval,
  RuleInput,
} from './hours.ts';
export {
  createFaqCard,
  deactivateFaqCard,
  findAnswer,
  groundedCandidates,
  updateFaqCard,
} from './faq.ts';
export type { FaqAnswer, FaqCard, FaqInput, FaqSensitivity } from './faq.ts';
export { approveFaqCard, approveKnowledge, bulkApprove, ForbiddenError } from './approval.ts';
export type { ApprovalResult, BulkApprovalResult } from './approval.ts';
export { REVERIFY_TASK_TITLE, lockEligibleCards, servedState, sweepReverify } from './staleness.ts';
export type { ServedVersion, SweepCandidate, SweepResult } from './staleness.ts';
export {
  CONFLICT_TASK_TITLE,
  FAQ_DUPLICATE_THRESHOLD,
  detectFaqDuplicates,
  detectHoursOverlaps,
  openConflict,
  orderLegs,
  resolveConflict,
} from './conflicts.ts';
export type { ConflictDetector, ConflictSubjectKind, ConflictSweepResult } from './conflicts.ts';
export { listCardCatalogue, findCandidates, readApprovedVersions } from './retrieval.ts';
export type { ApprovedVersion, CatalogueCard, RankedCandidate } from './retrieval.ts';
export {
  FetchRefusal,
  belongsToDomain,
  fetchPinnedForTest,
  isPrivateAddress,
  robotsAllows,
  safeFetch,
} from './import-fetch.ts';
export type {
  DnsLookup,
  FetchImpl,
  FetchRefusalReason,
  FetchedPage,
  SafeFetchOptions,
} from './import-fetch.ts';
export {
  ImportRefusal,
  flagsInjection,
  htmlToText,
  importWebsite,
  redactUrlForStorage,
  registrableDomain,
  structureSuggestions,
} from './import.ts';
export type {
  ImportRefusalReason,
  ImportSuggestion,
  ImportWebsiteInput,
  WebsiteImportResult,
} from './import.ts';
export { enqueueJob, JobConflictError } from './jobs.ts';
export type { EnqueueInput, JobRow } from './jobs.ts';
export { MAX_DEFER_SECONDS, abandonJob, executeJob } from './job-execution.ts';
export type {
  ClaimedJob,
  JobExecutionContext,
  JobExecutionRequest,
  JobExecutionResult,
  JobHandler,
} from './job-execution.ts';
