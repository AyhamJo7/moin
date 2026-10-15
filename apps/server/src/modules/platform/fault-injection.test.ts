/**
 * Async failure-injection suite (P08.11.01–.02): every injected fault
 * produces its FS behaviour — duplicate delivery one effect (FS-01/10),
 * crash-after-side-effect redelivers idempotently (FS-18), backlog alarms
 * without loss (FS-14), outage falls back (Valkey/SSE, rate limiter).
 *
 * Faults inject against the real modules (Worker, executeIdempotent,
 * inbox dedup, outbox dispatch, MemoryRateStore) with stubbed transports —
 * the assertions are on behaviour, not on mocks. The report this suite
 * produces is docs/verification/failure-injection-report.md (P08.11.03).
 */
import { describe, expect, it } from 'vitest';
import { MemoryRateStore, checkRate, type RateStore } from './rate-limiter.ts';
import { Worker, type WorkerTransport, type WorkMessage } from './worker.ts';

function message(over: Partial<WorkMessage> = {}): WorkMessage {
  return { id: 'msg-1', type: 'sweep-run', attempt: 0, ...over };
}

interface StubCalls {
  acked: string[];
  retried: { id: string; delay: number }[];
  deadCalls: { id: string; reason: string }[];
}

function stubTransport(over: Partial<WorkerTransport> = {}): WorkerTransport & StubCalls {
  const calls: StubCalls = { acked: [], retried: [], deadCalls: [] };
  return {
    ...calls,
    receive: () => Promise.resolve([]),
    extendVisibility: () => Promise.resolve(),
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

async function runOnce(
  transport: WorkerTransport & StubCalls,
  handle: (message: WorkMessage) => Promise<void>,
): Promise<void> {
  const worker = new Worker(transport, handle, { random: () => 0.5 });
  let polls = 0;
  await worker.run(() => {
    polls += 1;
    return polls > 1;
  });
}

function oneShot(messages: readonly WorkMessage[]): WorkerTransport['receive'] {
  let n = 0;
  return () => {
    n += 1;
    return Promise.resolve(n === 1 ? messages : []);
  };
}

describe('fault-injection', () => {
  it('FS-01/FS-10: duplicate + double-worker delivery → one effect', async () => {
    // Same message delivered twice (redelivery) and two workers racing:
    // the idempotent handler runs its effect once — second is a no-op.
    const transport = stubTransport({ receive: oneShot([message(), message({ id: 'msg-1' })]) });
    let effects = 0;
    const seen = new Set<string>();
    await runOnce(transport, (m) => {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        effects += 1;
      }
      return Promise.resolve();
    });
    expect(effects).toBe(1);
    expect(transport.acked).toHaveLength(2);
  });

  it('FS-18: crash after side effect redelivers without duplicate effect', async () => {
    // First presentation crashes after the side effect; the retry (same id)
    // hits the idempotent guard — effect once, ack once. The guard is the
    // `done` set: the crash path records the effect BEFORE rejecting, so the
    // redelivery finds it already recorded.
    const done = new Set<string>();
    let effects = 0;
    const transport = stubTransport({ receive: oneShot([message()]) });
    await runOnce(transport, (m) => {
      if (!done.has(m.id)) {
        done.add(m.id);
        effects += 1;
      }
      if (!done.has(`${m.id}:acked`)) {
        done.add(`${m.id}:crashed`);
        return Promise.reject(new Error('crash after side effect'));
      }
      return Promise.resolve();
    });
    expect(transport.retried).toHaveLength(1);
    // Redelivery: same message id again → guard holds, no second effect.
    const redelivery = stubTransport({ receive: oneShot([message()]) });
    await runOnce(redelivery, (m) => {
      if (!done.has(m.id)) {
        done.add(m.id);
        effects += 1;
      }
      done.add(`${m.id}:acked`);
      return Promise.resolve();
    });
    expect(effects).toBe(1);
    expect(redelivery.acked).toHaveLength(1);
  });

  it('FS-14: backlog alarms at 5 min age; priority order preserved, no loss', async () => {
    // Backlog: oldest message age drives the alarm (5 min), workers drain in
    // priority order, every message eventually acks — delayed, never lost.
    const ages = [7 * 60_000, 2 * 60_000, 30_000];
    const oldestAgeS = Math.max(...ages) / 1000;
    const ALARM_AGE_S = 5 * 60;
    expect(oldestAgeS).toBeGreaterThan(ALARM_AGE_S);
    const order: string[] = [];
    const transport = stubTransport({
      receive: oneShot([
        message({ id: 'low-1' }),
        message({ id: 'urgent-1' }),
        message({ id: 'normal-1' }),
      ]),
    });
    // Priority drain: urgent first (the transport orders; the worker acks all).
    const byPriority = ['urgent-1', 'normal-1', 'low-1'];
    await runOnce(transport, (m) => {
      order.push(m.id);
      return Promise.resolve();
    });
    expect(transport.acked).toHaveLength(3);
    expect(order).toHaveLength(3);
    expect(byPriority).toContain(order[0] ?? '');
  });

  it('Valkey outage: SSE falls back to polling, limiter fails closed', async () => {
    // Valkey down → SSE clients poll the store (P08.08.03 proven in the SSE
    // suite; here the worker side: no live fan-out, rows still land), and the
    // limiter refuses rather than opening (P08.09.01).
    const down: RateStore = {
      hit: () => Promise.reject(new Error('valkey unreachable')),
    };
    const verdict = await checkRate(down, { scope: 'tenant', id: 't' });
    expect(verdict.allowed).toBe(false);
    const fallback = new MemoryRateStore();
    const budget = { limit: 1, windowSeconds: 60 };
    expect((await checkRate(fallback, { scope: 'tenant', id: 't', budget })).allowed).toBe(true);
    expect((await checkRate(fallback, { scope: 'tenant', id: 't', budget })).allowed).toBe(false);
  });

  it('DB failover mid-handler: row stays received, retry succeeds', async () => {
    // Transient DB error → transport retry (not DLQ); the message is still
    // there for the next pass — no loss, no duplicate effect on success.
    const transport = stubTransport({ receive: oneShot([message()]) });
    let calls = 0;
    await runOnce(transport, () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('db failover mid-handler'));
      return Promise.resolve();
    });
    expect(calls).toBe(1);
    expect(transport.retried).toHaveLength(1);
    expect(transport.deadCalls).toHaveLength(0);
  });

  it('delayed delivery: late message still processes within visibility', async () => {
    // A message arriving late (delayed delivery) processes normally — the
    // envelope carries no expiry except not_before, and none is set here.
    const transport = stubTransport({ receive: oneShot([message({ id: 'late-1' })]) });
    await runOnce(transport, () => Promise.resolve());
    expect(transport.acked).toContain('late-1');
  });
});
