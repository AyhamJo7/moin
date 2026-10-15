/**
 * Tool guard tables (P10.08.06, INV-05/11): one test per pipeline step —
 * not-allowed, no permission, invalid args, failed precondition, wrong owner
 * (wrong tenant), duplicate key, approval-required — plus the happy path with
 * a result token, the reconcile loop, and the metric name. Synthetic only.
 */
import { describe, expect, it } from 'vitest';
import { COMMITMENT_WITHOUT_TOKEN, guardedExecute, reconcileUnknown } from './tools.ts';
import type { GuardPorts } from './tools.ts';
import { captureCallback, createAppointmentRequest } from './voice-tools.ts';

function ports(over: Partial<GuardPorts> = {}): GuardPorts & { audits: unknown[] } {
  const audits: unknown[] = [];
  return {
    audits,
    tenantAllowsTool: () => true,
    subjectHasPermission: () => true,
    callerOwns: () => true,
    checkIdempotency: () => 'fresh',
    isApproved: () => true,
    recordAudit: (entry) => {
      audits.push(entry);
    },
    execute: () => Promise.resolve('succeeded'),
    ...over,
  };
}

function call(over: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    channel: 'voice' as const,
    subject: 'agent-1',
    caller: 'owner-1',
    idempotencyKey: 'key-1',
    args: { callbackPhone: '+49151' },
    ...over,
  };
}

describe('tool guard', () => {
  it('executes the happy path with a result token and a sanitised audit', async () => {
    const p = ports();
    const outcome = await guardedExecute(captureCallback, call(), p);
    expect(outcome).toMatchObject({
      ok: true,
      token: { toolName: 'captureCallback', idempotencyKey: 'key-1', state: 'succeeded' },
    });
    expect(p.audits).toHaveLength(1);
    expect(JSON.stringify(p.audits)).not.toContain('+49151');
  });

  it('rejects per guard step, in pipeline order', async () => {
    await expect(
      guardedExecute(captureCallback, call(), ports({ tenantAllowsTool: () => false })),
    ).resolves.toMatchObject({ ok: false, rejection: 'tool-not-allowed' });
    await expect(
      guardedExecute(captureCallback, call({ channel: 'staff' }), ports()),
    ).resolves.toMatchObject({ ok: false, rejection: 'tool-not-allowed' });
    await expect(
      guardedExecute(captureCallback, call(), ports({ subjectHasPermission: () => false })),
    ).resolves.toMatchObject({ ok: false, rejection: 'missing-permission' });
    await expect(
      guardedExecute(captureCallback, call({ args: {} }), ports()),
    ).resolves.toMatchObject({ ok: false, rejection: 'invalid-args' });
    await expect(
      guardedExecute(captureCallback, call({ args: { callbackPhone: '+49' } }), ports()),
    ).resolves.toMatchObject({ ok: false, rejection: 'invalid-args' });
    await expect(
      guardedExecute(captureCallback, call({ args: { callbackPhone: 'not a number' } }), ports()),
    ).resolves.toMatchObject({ ok: false, rejection: 'precondition-failed' });
    await expect(
      guardedExecute(
        createAppointmentRequest,
        call({ args: { callerName: 'A', ownerId: 'owner-2', slot: 'morgen' } }),
        ports({ callerOwns: () => false }),
      ),
    ).resolves.toMatchObject({ ok: false, rejection: 'wrong-owner' });
    await expect(
      guardedExecute(captureCallback, call(), ports({ checkIdempotency: () => 'duplicate' })),
    ).resolves.toMatchObject({ ok: false, rejection: 'duplicate-key' });
    await expect(
      guardedExecute(
        createAppointmentRequest,
        call({ args: { callerName: 'A', ownerId: 'owner-1', slot: 'morgen' } }),
        ports({ isApproved: () => false }),
      ),
    ).resolves.toMatchObject({ ok: false, rejection: 'approval-required' });
  });

  it('reconciles unknown states without resolving optimistically', async () => {
    await expect(reconcileUnknown(() => Promise.resolve('succeeded'))).resolves.toBe('succeeded');
    await expect(reconcileUnknown(() => Promise.resolve('unknown'))).resolves.toBeNull();
  });

  it('names the zero-metric for commitments without a token (INV-05)', () => {
    expect(COMMITMENT_WITHOUT_TOKEN).toBe('commitment.without_token');
  });
});
