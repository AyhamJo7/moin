/**
 * SQS job queue adapter (P08.05, ADR-0008, ADR-0044).
 *
 * The port is `JobQueue`; the adapter is the AWS SDK in every environment. ElasticMQ locally and
 * SQS in AWS differ in configuration (`endpoint`, credentials from the SDK's default chain), never
 * in code.
 *
 * Message bodies are the job envelope, which is ID-only (P08.01.01). The adapter never logs a
 * body, and it surfaces queue failures as thrown errors for the consumer to decide on: a
 * transport that swallowed them would turn a lost delete or visibility change into silence.
 */

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

/** SQS allows at most 10 messages per receive. */
export const SQS_MAX_BATCH = 10;

/** SQS caps long polling at 20 seconds. */
export const SQS_MAX_WAIT_SECONDS = 20;

/** SQS caps a visibility timeout at 12 hours. */
export const SQS_MAX_VISIBILITY_SECONDS = 12 * 60 * 60;

export interface QueueMessage {
  readonly messageId: string;
  /** Opaque lease handle: valid only while the message is invisible to others. */
  readonly receiptHandle: string;
  readonly body: string;
  /** How many times the queue has delivered this message (ApproximateReceiveCount). */
  readonly receiveCount: number;
  /** String message attributes, e.g. the `reason` a dead-letter copy carries. */
  readonly attributes: Readonly<Record<string, string>>;
}

export interface ReceiveOptions {
  readonly max: number;
  readonly waitSeconds: number;
  /** Visibility timeout for the received messages, so the lease matches the consumer's heartbeat. */
  readonly visibilitySeconds?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface JobQueue {
  receive(options: ReceiveOptions): Promise<readonly QueueMessage[]>;
  /** Deletes the message. Only called after the durable effect has committed. */
  remove(message: QueueMessage): Promise<void>;
  /** Re-hides the message for `seconds` (0 releases it at once). */
  hide(message: QueueMessage, seconds: number): Promise<void>;
  /** Publishes a body with string attributes, e.g. a DLQ reason code. */
  send(body: string, attributes?: Readonly<Record<string, string>>): Promise<void>;
}

export interface SqsQueueConfig {
  readonly region: string;
  readonly queueName: string;
  /** Set for ElasticMQ or another emulator; unset for AWS. */
  readonly endpoint?: string | undefined;
}

class SqsJobQueue implements JobQueue {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async receive(options: ReceiveOptions): Promise<readonly QueueMessage[]> {
    const out = await this.#client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.#queueUrl,
        MaxNumberOfMessages: Math.min(Math.max(options.max, 1), SQS_MAX_BATCH),
        WaitTimeSeconds: Math.min(Math.max(options.waitSeconds, 0), SQS_MAX_WAIT_SECONDS),
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: ['All'],
        ...(options.visibilitySeconds === undefined
          ? {}
          : { VisibilityTimeout: options.visibilitySeconds }),
      }),
      options.signal === undefined ? undefined : { abortSignal: options.signal },
    );
    const messages: QueueMessage[] = [];
    for (const m of out.Messages ?? []) {
      if (m.MessageId === undefined || m.ReceiptHandle === undefined || m.Body === undefined) {
        continue;
      }
      messages.push({
        messageId: m.MessageId,
        receiptHandle: m.ReceiptHandle,
        body: m.Body,
        receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? '1'),
        attributes: Object.fromEntries(
          Object.entries(m.MessageAttributes ?? {}).flatMap(([key, value]) =>
            value.StringValue === undefined ? [] : [[key, value.StringValue]],
          ),
        ),
      });
    }
    return messages;
  }

  public async remove(message: QueueMessage): Promise<void> {
    await this.#client.send(
      new DeleteMessageCommand({ QueueUrl: this.#queueUrl, ReceiptHandle: message.receiptHandle }),
    );
  }

  public async hide(message: QueueMessage, seconds: number): Promise<void> {
    await this.#client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.#queueUrl,
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: Math.min(Math.max(Math.trunc(seconds), 0), SQS_MAX_VISIBILITY_SECONDS),
      }),
    );
  }

  public async send(
    body: string,
    attributes: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    await this.#client.send(
      new SendMessageCommand({
        QueueUrl: this.#queueUrl,
        MessageBody: body,
        MessageAttributes: Object.fromEntries(
          Object.entries(attributes).map(([key, value]) => [
            key,
            { DataType: 'String', StringValue: value },
          ]),
        ),
      }),
    );
  }
}

export interface SqsQueues {
  readonly jobs: JobQueue;
  readonly deadLetter: JobQueue;
  close(): void;
}

/**
 * Resolves the jobs queue and its dead-letter queue (`<name>-dlq`, the convention the local
 * topology and P05 share) and fails if either is missing, so a misconfigured worker stops at
 * startup instead of polling nothing.
 */
export async function connectSqsQueues(config: SqsQueueConfig): Promise<SqsQueues> {
  const client = new SQSClient({
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
  });
  try {
    const url = async (name: string): Promise<string> => {
      const out = await client.send(new GetQueueUrlCommand({ QueueName: name }));
      if (out.QueueUrl === undefined) throw new Error(`queue ${name} has no url`);
      return out.QueueUrl;
    };
    const [jobsUrl, dlqUrl] = await Promise.all([
      url(config.queueName),
      url(`${config.queueName}-dlq`),
    ]);
    return {
      jobs: new SqsJobQueue(client, jobsUrl),
      deadLetter: new SqsJobQueue(client, dlqUrl),
      close: () => {
        client.destroy();
      },
    };
  } catch (error) {
    client.destroy();
    throw error;
  }
}
