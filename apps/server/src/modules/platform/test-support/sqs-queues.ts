/**
 * Test-only: a uniquely named jobs queue and `<name>-dlq` on the local SQS emulator, so test files
 * never share a queue. Needs `TEST_SQS_ENDPOINT` (in `.env.example`); like the database URL, its
 * absence is a failure, not a skip.
 */
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { connectSqsQueues, type SqsQueues } from '@moin/integrations';

export const TEST_REGION = 'eu-central-1';

export interface TestQueues {
  readonly name: string;
  readonly endpoint: string;
  readonly queues: SqsQueues;
  /** Messages waiting and messages leased to a consumer, as the queue itself counts them. */
  counts(which: 'jobs' | 'deadLetter'): Promise<{ visible: number; leased: number }>;
  drop(): Promise<void>;
}

export async function createTestQueues(
  label: string,
  visibilitySeconds: number,
): Promise<TestQueues> {
  const endpoint = process.env['TEST_SQS_ENDPOINT'];
  if (endpoint === undefined) {
    throw new Error('TEST_SQS_ENDPOINT is not set; it is in .env.example (ElasticMQ).');
  }
  // The emulator ignores credentials, the SDK refuses to sign without some.
  process.env['AWS_ACCESS_KEY_ID'] ??= 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] ??= 'test';
  const name = `t-${label}-${Math.random().toString(36).slice(2, 10)}`;
  const admin = new SQSClient({ region: TEST_REGION, endpoint });
  await admin.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }));
  await admin.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: { VisibilityTimeout: String(visibilitySeconds) },
    }),
  );
  const queues = await connectSqsQueues({ region: TEST_REGION, queueName: name, endpoint });
  return {
    name,
    endpoint,
    queues,
    counts: async (which) => {
      const url = await admin.send(
        new GetQueueUrlCommand({ QueueName: which === 'jobs' ? name : `${name}-dlq` }),
      );
      const out = await admin.send(
        new GetQueueAttributesCommand({ QueueUrl: url.QueueUrl, AttributeNames: ['All'] }),
      );
      return {
        visible: Number(out.Attributes?.ApproximateNumberOfMessages ?? '0'),
        leased: Number(out.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0'),
      };
    },
    drop: async () => {
      queues.close();
      for (const queueName of [name, `${name}-dlq`]) {
        const url = await admin.send(new GetQueueUrlCommand({ QueueName: queueName }));
        await admin.send(new DeleteQueueCommand({ QueueUrl: url.QueueUrl }));
      }
      admin.destroy();
    },
  };
}
