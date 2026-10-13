/**
 * Worker runtime core (P08.05.01–.04, ADR-0008): the queue-agnostic loop every
 * consumer shares. The transport (SQS long-poll in workers, inline in tests)
 * is injected; this module owns the lifecycle every transport needs:
 *
 * - bounded concurrency (P08.05.01): at most `concurrency` handlers in flight;
 *   a slow handler never starves the loop, a burst never floods the pool.
 * - visibility extension (P08.05.01): `extendVisibility` is called when a
 *   handler runs past half its budget, so long jobs are not redelivered.
 * - graceful shutdown (P08.05.01, INV-19): `close()` stops polling, waits for
 *   in-flight handlers, and reports what drained — no message lost on SIGTERM.
 * - retry vs DLQ (P08.05.02): transient failures back off per `decideRetry`
 *   (ChangeMessageVisibility in SQS); exhausted attempts go to `toDlq`.
 * - poison (P08.05.03): RangeErrors go to DLQ immediately with their reason.
 *
 * Shutdown loses no message (P08.05.04): in-flight handlers complete, and an
 * un-acked message returns to the queue by visibility timeout — at-least-once
 * holds, and consumers are idempotent (P08.02–.04).
 */

import { backoffSeconds, decideRetry, isPoison } from '@moin/kernel';

export interface WorkMessage {
  readonly id: string;
  readonly type: string;
  readonly attempt: number;
}

export interface WorkerOutcome {
  readonly processed: number;
  readonly retried: number;
  readonly dead: number;
  readonly poisoned: number;
}

/** Transport seam: SQS implements it in workers; tests stub it. */
export interface WorkerTransport {
  /** Long-poll one batch (empty array = no work, poll again). */
  receive: () => Promise<readonly WorkMessage[]>;
  /** Extend visibility for a long-running handler, seconds. */
  extendVisibility: (id: string, seconds: number) => Promise<void>;
  /** Delete after success. */
  ack: (id: string) => Promise<void>;
  /** Requeue with delay (ChangeMessageVisibility). */
  retry: (id: string, delaySeconds: number) => Promise<void>;
  /** Move to DLQ with a reason. */
  dead: (id: string, reason: string) => Promise<void>;
}

export interface WorkerOptions {
  readonly concurrency?: number | undefined;
  /** Visibility budget per message, seconds (extension at half). */
  readonly visibilitySeconds?: number | undefined;
  readonly random?: (() => number) | undefined;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_VISIBILITY_S = 60;

export class Worker {
  private running = false;
  private closed = false;
  private inFlight = 0;
  private processed = 0;
  private retried = 0;
  private deadCount = 0;
  private poisoned = 0;

  public constructor(
    private readonly transport: WorkerTransport,
    private readonly handle: (message: WorkMessage) => Promise<void>,
    private readonly options: WorkerOptions = {},
  ) {}

  /** Poll until `shouldStop` or `close()`: one batch, bounded handlers. */
  public async run(shouldStop: () => boolean): Promise<WorkerOutcome> {
    this.running = true;
    try {
      while (!shouldStop() && !this.closed) {
        const batch = await this.transport.receive();
        if (batch.length === 0) {
          if (shouldStop() || this.closed) break;
          continue;
        }
        await this.runBatch(batch);
      }
      // Graceful drain: in-flight handlers already awaited per batch.
      return {
        processed: this.processed,
        retried: this.retried,
        dead: this.deadCount,
        poisoned: this.poisoned,
      };
    } finally {
      this.running = false;
    }
  }

  /** Stop polling after the current batch; in-flight completes (INV-19). */
  public close(): void {
    this.closed = true;
  }

  public get draining(): boolean {
    return this.running && this.closed;
  }

  private async runBatch(batch: readonly WorkMessage[]): Promise<void> {
    const limit = this.options.concurrency ?? DEFAULT_CONCURRENCY;
    const visibility = this.options.visibilitySeconds ?? DEFAULT_VISIBILITY_S;
    const running: Promise<void>[] = [];
    for (const message of batch) {
      while (this.inFlight >= limit) {
        const settled = await Promise.race(running.map((p, i) => p.then(() => i)));
        running.splice(settled as number, 1);
      }
      this.inFlight += 1;
      const done = this.runOne(message, visibility).finally(() => {
        this.inFlight -= 1;
      });
      running.push(done);
    }
    await Promise.all(running);
  }

  private async runOne(message: WorkMessage, visibility: number): Promise<void> {
    const random = this.options.random;
    const budgetMs = (visibility * 1000) / 2;
    const started = Date.now();
    let extended = false;
    const extendTimer = setInterval(() => {
      if (Date.now() - started >= budgetMs && !extended) {
        extended = true;
        void this.transport.extendVisibility(message.id, visibility).catch(() => undefined);
      }
    }, Math.max(budgetMs, 100));
    try {
      await this.handle(message);
      await this.transport.ack(message.id);
      this.processed += 1;
    } catch (error) {
      if (isPoison(error)) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : 'poison';
        await this.transport.dead(message.id, reason);
        this.poisoned += 1;
        return;
      }
      const decision = decideRetry(message.type, message.attempt, random);
      if (decision.toDlq) {
        const reason = error instanceof Error ? error.message.slice(0, 200) : 'exhausted';
        await this.transport.dead(message.id, reason);
        this.deadCount += 1;
      } else {
        await this.transport.retry(message.id, decision.delaySeconds);
        this.retried += 1;
      }
    } finally {
      clearInterval(extendTimer);
      // A handler that outran half its budget without the timer firing (short
      // budgets) still gets one extension — belt and braces for long jobs.
      if (!extended && Date.now() - started >= budgetMs) {
        await this.transport
          .extendVisibility(message.id, backoffSeconds(message.attempt, random))
          .catch(() => undefined);
      }
    }
  }
}
