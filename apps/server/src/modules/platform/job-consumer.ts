/**
 * Job consumer (P08.05.01–.03, ADR-0008, INV-11, INV-19).
 *
 * Receives envelopes from the jobs queue and hands each to `executeJob`, which runs the handler
 * and the ledger write in one tenant transaction. This class owns everything around that:
 *
 * - **Ordering of acknowledgement.** A message is deleted only after `executeJob` has committed
 *   its outcome (success, duplicate, or a dead row whose DLQ copy exists). Receipt is never
 *   success. A failed delete is harmless: the redelivery finds `succeeded` and deletes again.
 * - **The tenant comes from the envelope and is verified by the ledger.** The envelope's
 *   `organisationId` only selects the RLS scope; the job row must be visible in that scope and
 *   agree on type, version and correlation id, or the message is rejected (INV-02).
 * - **Bounded concurrency.** At most `concurrency` deliveries are in flight; the consumer asks
 *   the queue for no more than it has free slots for, so nothing sits received but unstarted.
 * - **Visibility heartbeat.** While a handler runs, the message is re-hidden every third of the
 *   visibility timeout, so a long job is not redelivered to a second worker.
 * - **Poison and exhausted jobs go to the DLQ queue first and are deleted second.** If the DLQ
 *   send fails the original stays on the queue; nothing is dropped.
 * - **Logs carry ids and codes only.** Never a body, payload or error message (INV-12).
 *
 * Shutdown: `stop()` ends polling (aborting the long poll), waits up to `drainTimeoutMs` for
 * in-flight deliveries, and never acknowledges one that has not committed. What it abandons
 * returns to the queue when its visibility lapses.
 */

import { lintEnvelope, type JobEnvelope, type JobType, JobFailure } from '@moin/kernel';
import { executeJob, type JobHandler, type JobExecutionResult } from '@moin/db';
import type { Pool } from '@moin/db/pool';
import type { JobQueue, QueueMessage } from '@moin/integrations';
import type { Logger } from '@moin/observability';

/** Handlers by `type@version`. A type with no registered handler is retried, not dropped. */
export class JobHandlerRegistry {
  readonly #handlers = new Map<string, JobHandler>();

  public register(type: JobType, version: number, handler: JobHandler): this {
    const key = `${type}@${String(version)}`;
    if (this.#handlers.has(key)) throw new Error(`handler already registered for ${key}`);
    this.#handlers.set(key, handler);
    return this;
  }

  public get(type: JobType, version: number): JobHandler | undefined {
    return this.#handlers.get(`${type}@${String(version)}`);
  }
}

export interface JobConsumerOptions {
  readonly concurrency: number;
  /** The queue's visibility timeout, seconds; the heartbeat re-hides for this long. */
  readonly visibilitySeconds: number;
  readonly waitSeconds: number;
  readonly drainTimeoutMs: number;
  /** Re-hide delay for a job another worker is running right now. */
  readonly busyRetrySeconds?: number | undefined;
  readonly random?: (() => number) | undefined;
}

export interface JobConsumerDeps {
  readonly pool: Pool;
  readonly queue: JobQueue;
  readonly deadLetter: JobQueue;
  readonly handlers: JobHandlerRegistry;
  readonly logger: Logger;
  readonly options: JobConsumerOptions;
  /** True once the process has begun shutting down (readiness already 503): take no new work. */
  readonly isShuttingDown?: (() => boolean) | undefined;
}

export interface StopReport {
  /** Deliveries still running when the drain budget ended; left unacknowledged. */
  readonly abandoned: number;
}

const DEFAULT_BUSY_RETRY_S = 5;
const HEARTBEAT_DIVISOR = 3;
const RECEIVE_FAILURE_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

/** Rejection reasons that go to the DLQ with the original body. */
type RejectReason = 'envelope-invalid' | 'tenant-required' | 'job-unknown' | 'job-mismatch';

export class JobConsumer {
  readonly #deps: JobConsumerDeps;
  readonly #inFlight = new Set<Promise<void>>();
  readonly #poll = new AbortController();
  #stopping = false;
  #abandoned = false;
  #loop: Promise<void> | undefined;

  public constructor(deps: JobConsumerDeps) {
    if (!Number.isInteger(deps.options.concurrency) || deps.options.concurrency < 1) {
      throw new RangeError('concurrency must be a positive integer');
    }
    this.#deps = deps;
  }

  public start(): void {
    if (this.#loop !== undefined) throw new Error('consumer already started');
    this.#loop = this.#run();
  }

  public async stop(): Promise<StopReport> {
    this.#stopping = true;
    this.#poll.abort();
    await this.#loop;
    const drained = await Promise.race([
      Promise.allSettled([...this.#inFlight]).then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => {
          resolve(false);
        }, this.#deps.options.drainTimeoutMs).unref();
      }),
    ]);
    const abandoned = drained ? 0 : this.#inFlight.size;
    // Abandoned deliveries stop extending their messages: they must return to the queue.
    this.#abandoned = !drained;
    this.#deps.logger.info(
      { outcome: 'consumer stopped', count: abandoned },
      'job consumer stopped',
    );
    return { abandoned };
  }

  #halted(): boolean {
    return this.#stopping || (this.#deps.isShuttingDown?.() ?? false);
  }

  async #run(): Promise<void> {
    const { queue, logger, options } = this.#deps;
    let failures = 0;
    while (!this.#halted()) {
      while (this.#inFlight.size >= options.concurrency && !this.#halted()) {
        await Promise.race(this.#inFlight);
      }
      if (this.#halted()) break;
      let batch: readonly QueueMessage[];
      try {
        batch = await queue.receive({
          max: options.concurrency - this.#inFlight.size,
          waitSeconds: options.waitSeconds,
          signal: this.#poll.signal,
        });
        failures = 0;
      } catch (error) {
        if (this.#stopping) break;
        const delay =
          RECEIVE_FAILURE_BACKOFF_MS[Math.min(failures, RECEIVE_FAILURE_BACKOFF_MS.length - 1)] ??
          30_000;
        failures += 1;
        logger.error(
          { err: error, outcome: 'receive failed', durationMs: delay },
          'queue receive failed; backing off',
        );
        await sleep(delay, this.#poll.signal);
        continue;
      }
      for (const message of batch) {
        if (this.#halted()) {
          // Received after shutdown began: give it straight back, untouched.
          await this.#settle(this.#deps.queue.hide(message, 0), 'release on shutdown');
          continue;
        }
        const delivery: Promise<void> = this.#deliver(message).finally(() => {
          this.#inFlight.delete(delivery);
        });
        this.#inFlight.add(delivery);
      }
    }
  }

  async #deliver(message: QueueMessage): Promise<void> {
    const { logger } = this.#deps;
    try {
      await this.#process(message);
    } catch (error) {
      // Database or queue unreachable, or a bug. The message stays unacknowledged and returns when
      // its visibility lapses; the ledger was never advanced past a commit.
      logger.error(
        { err: error, outcome: 'delivery failed' },
        'delivery failed; message left for redelivery',
      );
    }
  }

  async #process(message: QueueMessage): Promise<void> {
    const envelope = parseEnvelope(message.body);
    if (envelope === null) return this.#reject(message, 'envelope-invalid');
    if (envelope.organisationId === null) return this.#reject(message, 'tenant-required');

    const { pool, handlers, logger, options } = this.#deps;
    const organisationId = envelope.organisationId;
    const fields = {
      jobId: envelope.jobId,
      organisationId,
      correlationId: envelope.correlationId,
    };
    const handler =
      handlers.get(envelope.type, envelope.version) ??
      (() => Promise.reject(new JobFailure('handler-unavailable')));

    const beat = setInterval(
      () => {
        if (this.#abandoned) return;
        this.#deps.queue.hide(message, options.visibilitySeconds).catch((error: unknown) => {
          logger.warn(
            { err: error, ...fields, outcome: 'heartbeat failed' },
            'visibility extension failed',
          );
        });
      },
      Math.max((options.visibilitySeconds * 1000) / HEARTBEAT_DIVISOR, 50),
    );
    beat.unref();
    let result: JobExecutionResult;
    try {
      result = await executeJob(pool, {
        jobId: envelope.jobId,
        organisationId,
        type: envelope.type,
        version: envelope.version,
        correlationId: envelope.correlationId,
        handler,
        random: options.random,
      });
    } finally {
      clearInterval(beat);
    }
    logger.info({ ...fields, outcome: result.kind, attempt: envelope.attempt }, 'job delivery');
    // Past the drain budget the process is on its way out: acknowledge nothing, let the queue
    // return the message when its visibility lapses.
    if (this.#abandoned) return;

    switch (result.kind) {
      case 'succeeded':
      case 'duplicate':
        return this.#settle(this.#deps.queue.remove(message), 'delete after commit');
      case 'busy':
        return this.#settle(
          this.#deps.queue.hide(message, options.busyRetrySeconds ?? DEFAULT_BUSY_RETRY_S),
          'hide busy job',
        );
      case 'deferred':
        return this.#settle(this.#deps.queue.hide(message, result.seconds), 'hide deferred job');
      case 'retry':
        return this.#settle(this.#deps.queue.hide(message, result.delaySeconds), 'schedule retry');
      case 'dead':
        return this.#deadLetter(message, result.errorCode);
      case 'unknown':
        return this.#reject(message, 'job-unknown');
      case 'mismatch':
        return this.#reject(message, 'job-mismatch');
    }
  }

  #reject(message: QueueMessage, reason: RejectReason): Promise<void> {
    this.#deps.logger.warn({ outcome: reason }, 'message rejected to the dead-letter queue');
    return this.#deadLetter(message, reason);
  }

  /** DLQ copy first, original deleted second: a failed send leaves the original in place. */
  async #deadLetter(message: QueueMessage, reason: string): Promise<void> {
    const { deadLetter, queue, logger } = this.#deps;
    try {
      await deadLetter.send(message.body, { reason });
    } catch (error) {
      logger.error(
        { err: error, outcome: 'dead-letter send failed' },
        'dead-letter send failed; original message kept',
      );
      return;
    }
    await this.#settle(queue.remove(message), 'delete after dead-letter');
  }

  /** Queue acknowledgements that fail are logged: redelivery is safe by construction. */
  async #settle(action: Promise<void>, what: string): Promise<void> {
    try {
      await action;
    } catch (error) {
      this.#deps.logger.warn(
        { err: error, outcome: `${what} failed` },
        'queue acknowledgement failed',
      );
    }
  }
}

function parseEnvelope(body: string): JobEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return lintEnvelope(parsed).ok ? (parsed as JobEnvelope) : null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
