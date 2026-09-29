import { describe, expect, it, vi } from 'vitest';
import { InjectedFault, neverSettles, slow, withFault } from './inject.ts';

describe('fault injection', () => {
  it('fails the first N calls and then succeeds, so a retry path can be proven to recover', async () => {
    const underlying = vi.fn(() => Promise.resolve('ok'));
    const flaky = withFault(underlying, { kind: 'rate-limited', failTimes: 2 });

    await expect(flaky()).rejects.toThrow(InjectedFault);
    await expect(flaky()).rejects.toThrow(InjectedFault);
    await expect(flaky()).resolves.toBe('ok');
    expect(flaky.calls()).toBe(3);
    // The underlying call happened only on the successful attempt.
    expect(underlying).toHaveBeenCalledOnce();
  });

  it('fails every call when no limit is given', async () => {
    const always = withFault(() => Promise.resolve('ok'), { kind: 'server-error' });
    await expect(always()).rejects.toThrow(/server-error/);
    await expect(always()).rejects.toThrow(/server-error/);
  });

  it('carries the fault kind, so a test can assert the branch it exercised', async () => {
    const failing = withFault(() => Promise.resolve(1), { kind: 'unknown-outcome' });
    await failing().catch((error: unknown) => {
      expect(error).toBeInstanceOf(InjectedFault);
      expect((error as InjectedFault).kind).toBe('unknown-outcome');
    });
  });

  // Code that awaits a provider with no deadline does not hang loudly: it holds a connection, a
  // queue slot or a call open until something else gives up.
  it('provides a promise that never settles, for proving a caller applies its own deadline', async () => {
    const deadline = new Promise((resolve) =>
      setTimeout(() => {
        resolve('deadline');
      }, 20),
    );
    await expect(Promise.race([neverSettles<string>(), deadline])).resolves.toBe('deadline');
  });

  it('provides a slow resolve for racing a deadline', async () => {
    const started = Date.now();
    await expect(slow('late', 25)).resolves.toBe('late');
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });
});
