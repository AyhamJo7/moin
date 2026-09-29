import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type { ReadinessCheck } from '@moin/db';
import { HealthController } from './health.controller.ts';
import { READINESS_CHECKS, SHUTDOWN_STATE } from './health.tokens.ts';
import { ShutdownState } from './shutdown-state.ts';
import { LOGGER } from '../observability/logger.module.ts';

interface FakeReply {
  statusCode: number | undefined;
  status(code: number): FakeReply;
}

/** A reply that records what the controller set, without a real HTTP server. */
function fakeReply(): FakeReply {
  const reply: FakeReply = {
    statusCode: undefined,
    status(code: number): FakeReply {
      reply.statusCode = code;
      return reply;
    },
  };
  return reply;
}

function check(
  name: string,
  result: Partial<Awaited<ReturnType<ReadinessCheck['check']>>>,
): ReadinessCheck {
  return {
    name,
    check: () => Promise.resolve({ name, ready: true, durationMs: 1, ...result }),
    close: () => Promise.resolve(),
  };
}

async function build(checks: ReadinessCheck[], shutdown = new ShutdownState()) {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: READINESS_CHECKS, useValue: checks },
      { provide: SHUTDOWN_STATE, useValue: shutdown },
      { provide: LOGGER, useValue: logger },
    ],
  }).compile();
  return { controller: moduleRef.get(HealthController), logger, shutdown };
}

describe('health endpoints', () => {
  it('liveness reports ok and reveals nothing else', async () => {
    const { controller } = await build([]);
    expect(controller.liveness()).toStrictEqual({ status: 'ok' });
  });

  it('readiness is 200 when every check is ready', async () => {
    const { controller } = await build([check('postgres', { ready: true })]);
    const reply = fakeReply();
    const body = await controller.readiness(reply as never);
    expect(reply.statusCode).toBe(200);
    expect(body).toStrictEqual({ status: 'ready', checks: [{ name: 'postgres', ready: true }] });
  });

  it('readiness is 503 when a check is not ready', async () => {
    const { controller } = await build([
      check('postgres', { ready: false, reason: 'connection refused' }),
    ]);
    const reply = fakeReply();
    const body = await controller.readiness(reply as never);
    expect(reply.statusCode).toBe(503);
    expect(body.status).toBe('not_ready');
  });

  // The endpoint is unauthenticated, so the body must not hand out a timing oracle on the
  // internal database, the role of the host, or a reason such as "authentication failed" that
  // announces a credential-rotation window.
  it('never returns a reason, a duration or the role to an unauthenticated caller', async () => {
    const { controller } = await build([
      check('postgres', { ready: false, reason: 'authentication failed', durationMs: 1234 }),
    ]);
    const rendered = JSON.stringify(await controller.readiness(fakeReply() as never));
    expect(rendered).not.toContain('authentication failed');
    expect(rendered).not.toContain('1234');
    expect(rendered).not.toContain('role');
  });

  it('still logs the detail an operator needs', async () => {
    const { controller, logger } = await build([
      check('postgres', { ready: false, reason: 'connection refused' }),
    ]);
    await controller.readiness(fakeReply() as never);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls[0])).toContain('connection refused');
  });

  // A probe that throws must still produce a structured not-ready. Promise.all would reject and
  // turn a dependency problem into a 500 with a framework error body.
  it('treats a throwing check as not ready, not as a server error', async () => {
    const throwing: ReadinessCheck = {
      name: 'valkey',
      check: () => Promise.reject(new Error('boom')),
      close: () => Promise.resolve(),
    };
    const { controller } = await build([throwing]);
    const reply = fakeReply();
    const body = await controller.readiness(reply as never);
    expect(reply.statusCode).toBe(503);
    expect(body.checks).toStrictEqual([{ name: 'valkey', ready: false }]);
  });

  // Liveness must stay 200 while draining, or the orchestrator kills the container instead of
  // letting the load balancer take it out of rotation (INV-19).
  it('reports not ready while draining, but stays alive', async () => {
    const shutdown = new ShutdownState();
    const { controller } = await build([check('postgres', { ready: true })], shutdown);
    shutdown.beginShutdown();

    const reply = fakeReply();
    const body = await controller.readiness(reply as never);
    expect(reply.statusCode).toBe(503);
    expect(body.status).toBe('not_ready');
    expect(controller.liveness()).toStrictEqual({ status: 'ok' });
  });
});
