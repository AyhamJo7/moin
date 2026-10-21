/**
 * The SQS adapter against a real SQS-compatible emulator (ElasticMQ): send, long-poll receive,
 * hide (visibility change), remove, and an aborted poll. Needs TEST_SQS_ENDPOINT.
 */
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { evidenceTest } from '@moin/testing';
import { afterAll, beforeAll, describe, expect } from 'vitest';
import { connectSqsQueues, type SqsQueues } from './sqs-queue.ts';

const endpoint = process.env['TEST_SQS_ENDPOINT'];
const REGION = 'eu-central-1';
const name = `t-sqs-adapter-${Math.random().toString(36).slice(2, 10)}`;
let admin: SQSClient;
let queues: SqsQueues;

beforeAll(async () => {
  if (endpoint === undefined) throw new Error('TEST_SQS_ENDPOINT is not set (see .env.example)');
  process.env['AWS_ACCESS_KEY_ID'] ??= 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] ??= 'test';
  admin = new SQSClient({ region: REGION, endpoint });
  await admin.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }));
  await admin.send(
    new CreateQueueCommand({ QueueName: name, Attributes: { VisibilityTimeout: '30' } }),
  );
  queues = await connectSqsQueues({ region: REGION, queueName: name, endpoint });
});

afterAll(async () => {
  queues.close();
  for (const queueName of [name, `${name}-dlq`]) {
    const url = await admin.send(new GetQueueUrlCommand({ QueueName: queueName }));
    await admin.send(new DeleteQueueCommand({ QueueUrl: url.QueueUrl }));
  }
  admin.destroy();
});

describe('SqsJobQueue', () => {
  evidenceTest(
    'a sent body is received once, hidden while leased, and gone after remove',
    async () => {
      await queues.jobs.send('{"hello":"world"}', { reason: 'unit' });
      const [message] = await queues.jobs.receive({ max: 1, waitSeconds: 2 });
      expect(message?.body).toBe('{"hello":"world"}');
      expect(message?.receiveCount).toBe(1);
      expect(message?.attributes).toEqual({ reason: 'unit' });
      if (message === undefined) return;
      expect(await queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
      await queues.jobs.remove(message);
      await queues.jobs
        .hide({ ...message, receiptHandle: message.receiptHandle }, 0)
        .catch(() => undefined);
      expect(await queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
    },
  );

  evidenceTest('hide(0) releases a message at once and the next delivery counts up', async () => {
    await queues.jobs.send('retry-me');
    const [first] = await queues.jobs.receive({ max: 1, waitSeconds: 2 });
    if (first === undefined) throw new Error('no message');
    await queues.jobs.hide(first, 0);
    const [second] = await queues.jobs.receive({ max: 1, waitSeconds: 2 });
    expect(second?.body).toBe('retry-me');
    expect(second?.receiveCount).toBe(2);
    if (second !== undefined) await queues.jobs.remove(second);
  });

  evidenceTest('hide(n) keeps a message invisible past the queue default', async () => {
    await queues.jobs.send('later');
    const [message] = await queues.jobs.receive({ max: 1, waitSeconds: 2 });
    if (message === undefined) throw new Error('no message');
    await queues.jobs.hide(message, 1);
    expect(await queues.jobs.receive({ max: 1, waitSeconds: 0 })).toHaveLength(0);
    const [again] = await queues.jobs.receive({ max: 1, waitSeconds: 3 });
    expect(again?.body).toBe('later');
    if (again !== undefined) await queues.jobs.remove(again);
  });

  evidenceTest('an aborted long poll rejects promptly', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = queues.deadLetter.receive({
      max: 1,
      waitSeconds: 20,
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort();
    }, 200);
    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  evidenceTest('a missing queue fails at connect, not at first poll', async () => {
    await expect(
      connectSqsQueues({ region: REGION, queueName: 'does-not-exist-anywhere', endpoint }),
    ).rejects.toThrow();
  });
});
