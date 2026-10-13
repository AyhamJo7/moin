/**
 * Worker runtime (P08.05.01–.04): bounded concurrency, retry vs DLQ, poison
 * immediacy, graceful shutdown without loss. Transport stubbed; no I/O.
 */
import { describe, expect, it } from 'vitest';
import { Worker, type WorkerTransport, type WorkMessage } from './worker.ts';

interface StubTransport extends WorkerTransport {
  acked: string[];
  retried: Array<{ id: string; delay: number }>;
  deadCalls: Array<{ id: string; reason: string }>;
  extended: string[];
}

function stub(over: Partial<WorkerTransport> = {}): StubTransport {
  const calls = {
    acked: [] as string[],
    retried: [] as Array<{ id: string; delay: number }>,
    deadCalls: [] as Array<{ id: string; reason: string }>,
    extended: [] as string[],
  };
  return {
    ...calls,
    receive: () => Promise.resolve([]),
    extendVisibility: (id: string) => {
      calls.extended.push(id);
      return Promise.resolve();
    },
    ack: (id: string) => {
      calls.acked.push(id);
      return Promise.resolve();
    },
    retry: (id: string, delay: number) => {
      calls.retried.push({ id, delay });
      return Promise.resolve();
    },
    dead: (id: string, reason: string) => {
      calls.deadCalls.push({ id, reason });
      return Promise.resolve();
    },
    ...over,
  };
}

function message(over: Partial<WorkMessage> = {}): WorkMessage {
  return { id: 'msg-1', type: 'sweep-run', attempt: 0, ...over };
}

describe('worker', () => {
  it('transient failure retries with backoff; success acks', async () => {
    const transport = stub({
      receive: (() => {
        let n = 0;
        return () => {
          n += 1;
          if (n === 1) return Promise.resolve([message()]);
          return Promise.resolve([]);
        };
      })(),
    });
    let calls = 0;
    const worker = new Worker(
      transport,
      () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('db failover mid-handler'));
        return Promise.resolve();
      },
      { random: () => 0.5 },
    );
    let polls = 0;
    const outcome = await worker.run(() => {
      polls += 1;
      return polls > 1;
    });
    void outcome;
    expect(calls).toBe(1);
    expect(transport.retried).toHaveLength(1);
    expect(transport.retried[0]?.delay).toBeGreaterThan(0);
    expect(transport.acked).toHaveLength(0);
  });

  it('permanent failure and poison go to DLQ immediately with reason', async () => {
    const poisonTransport = stub({
      receive: (() => {
        let n = 0;
        return () => {
          n += 1;
          if (n === 1) return Promise.resolve([message({ id: 'poison-1' })]);
          return Promise.resolve([]);
        };
      })(),
    });
    const poison = new Worker(
      poisonTransport,
      () => Promise.reject(new RangeError('payload failed validation')),
      { random: () => 0.5 },
    );
    let poisonPolls = 0;
    await poison.run(() => {
      poisonPolls += 1;
      return poisonPolls > 1;
    });
    expect(poisonTransport.deadCalls).toHaveLength(1);
    expect(poisonTransport.deadCalls[0]?.reason).toContain('payload failed validation');
    expect(poisonTransport.retried).toHaveLength(0);

    const exhaustedTransport = stub({
      receive: (() => {
        let n = 0;
        return () => {
          n += 1;
          if (n === 1) return Promise.resolve([message({ id: 'old-1', attempt: 5 })]);
          return Promise.resolve([]);
        };
      })(),
    });
    const exhausted = new Worker(
      exhaustedTransport,
      () => Promise.reject(new Error('still failing')),
      { random: () => 0.5 },
    );
    let exhaustedPolls = 0;
    await exhausted.run(() => {
      exhaustedPolls += 1;
      return exhaustedPolls > 1;
    });
    expect(exhaustedTransport.deadCalls).toHaveLength(1);
    expect(exhaustedTransport.retried).toHaveLength(0);
  });

  it('shutdown drains in-flight without loss', async () => {
    const transport = stub({
      receive: (() => {
        let n = 0;
        return () => {
          n += 1;
          if (n === 1) return Promise.resolve([message({ id: 'a' }), message({ id: 'b' })]);
          return Promise.resolve([]);
        };
      })(),
    });
    const worker = new Worker(transport, () => Promise.resolve(), { concurrency: 1 });
    let polls = 0;
    const outcome = await worker.run(() => {
      polls += 1;
      if (polls > 2) worker.close();
      return polls > 4;
    });
    expect(outcome.processed).toBe(2);
    expect(transport.acked).toHaveLength(2);
  });
});
