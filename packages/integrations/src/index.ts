// @moin/integrations — Adapters behind ports: stripe, google, microsoft, ses, sms, webpush, s3, secrets.
// Declared in P02.03 so the workspace graph and the module-boundary rules are complete;
// filled in P20.
export const PACKAGE_NAME = '@moin/integrations';
export { normalizeSubject, threadGroups, draftReply } from './email.ts';
export type { EmailMessage, ReplyDraft } from './email.ts';
export {
  WEBHOOK_EVENTS,
  eventAllowed,
  subscribe,
  signDelivery,
  signatureValid,
  retryDelayMs,
} from './webhooks.ts';
export type { Subscription } from './webhooks.ts';
export {
  SQS_MAX_BATCH,
  SQS_MAX_VISIBILITY_SECONDS,
  SQS_MAX_WAIT_SECONDS,
  connectSqsQueues,
} from './queue/sqs-queue.ts';
export type {
  JobQueue,
  QueueMessage,
  ReceiveOptions,
  SqsQueueConfig,
  SqsQueues,
} from './queue/sqs-queue.ts';
