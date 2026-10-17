/**
 * Live Heute polling (P13.02.04, M2B): what the page polls, when it asks for a new render, and
 * that failures, overlap, hidden tabs and an expired session are handled without touching the
 * list on screen. `fetch`, the clock and visibility are parameters; no browser needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TODAY_PATH, type TodayTask } from '@moin/contracts';
import {
  LIVE_BACKOFF_MAX_MS,
  LIVE_IDLE_MS,
  isAttended,
  LIVE_POLL_MS,
  fingerprintOf,
  nextDelayMs,
  pollToday,
  startLivePoll,
  type PollResult,
} from './live-today.ts';

const TASK: TodayTask = {
  id: '6f0f8a2e-6a39-4f7b-9d0e-2d4c4b7f3a11',
  title: 'Rückruf: Tischreservierung',
  type: 'callback',
  status: 'open',
  priority: 'normal',
  createdAt: '2026-10-17T10:00:00.000Z',
  version: 1,
  callerNumber: '+4915198765432',
};

function answering(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('fingerprintOf', () => {
  it('changes with a new task, a new version, a status change or truncation', () => {
    const base = fingerprintOf([TASK], false);
    expect(fingerprintOf([TASK], false)).toBe(base);
    expect(fingerprintOf([], false)).not.toBe(base);
    expect(fingerprintOf([{ ...TASK, version: 2 }], false)).not.toBe(base);
    expect(fingerprintOf([{ ...TASK, status: 'done' }], false)).not.toBe(base);
    expect(fingerprintOf([TASK], true)).not.toBe(base);
  });
});

describe('pollToday', () => {
  it('reads the authenticated Today route with the session cookie, uncached', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const result = await pollToday((input, init) => {
      seen = { url: input instanceof Request ? input.url : input.toString(), init };
      return Promise.resolve(
        new Response(JSON.stringify({ tasks: [TASK], truncated: false }), { status: 200 }),
      );
    });
    expect(result).toEqual({ kind: 'ok', fingerprint: fingerprintOf([TASK], false) });
    expect(seen?.url).toBe(TODAY_PATH);
    expect(seen?.init).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });
  });

  it('maps 401 to signed-out and everything else unexpected to failed', async () => {
    expect(await pollToday(answering(401, {}))).toEqual({ kind: 'signed-out' });
    expect(await pollToday(answering(429, {}))).toEqual({ kind: 'failed' });
    expect(await pollToday(answering(503, {}))).toEqual({ kind: 'failed' });
    expect(await pollToday(answering(200, { tasks: 'nope' }))).toEqual({ kind: 'failed' });
    expect(await pollToday(() => Promise.reject(new TypeError('network')))).toEqual({
      kind: 'failed',
    });
    expect(await pollToday(() => Promise.resolve(new Response('<html>', { status: 200 })))).toEqual(
      { kind: 'failed' },
    );
  });
});

describe('nextDelayMs', () => {
  it('stays within the jitter band of the interval, doubles per failure and is capped', () => {
    expect(nextDelayMs(0, () => 0.5)).toBe(LIVE_POLL_MS);
    expect(nextDelayMs(0, () => 0)).toBe(LIVE_POLL_MS * 0.9);
    expect(nextDelayMs(1, () => 0.5)).toBe(LIVE_POLL_MS * 2);
    expect(nextDelayMs(50, () => 0.5)).toBe(LIVE_BACKOFF_MAX_MS);
  });
});

describe('startLivePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(results: PollResult[], rendered: string | null = 'A') {
    let visible = true;
    let renderedNow = rendered;
    const onChange = vi.fn();
    const poll = vi.fn(() => Promise.resolve(results.shift() ?? ({ kind: 'failed' } as const)));
    const loop = startLivePoll({
      rendered: () => renderedNow,
      onChange,
      isVisible: () => visible,
      poll,
      random: () => 0.5,
    });
    return {
      loop,
      onChange,
      poll,
      setVisible: (value: boolean) => {
        visible = value;
      },
      setRendered: (value: string | null) => {
        renderedNow = value;
      },
    };
  }

  it('asks for a new render only when the answer differs from the page', async () => {
    const h = harness([
      { kind: 'ok', fingerprint: 'A' },
      { kind: 'ok', fingerprint: 'B' },
    ]);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.poll).toHaveBeenCalledTimes(1);
    expect(h.onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    h.loop.stop();
  });

  it('treats the error state (null) as different from any answer, so recovery re-renders', async () => {
    const h = harness([{ kind: 'ok', fingerprint: 'A' }], null);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    h.loop.stop();
  });

  it('never overlaps polls: a slow answer delays the next poll instead of doubling it', async () => {
    let release: (value: PollResult) => void = () => undefined;
    const poll = vi.fn(
      () =>
        new Promise<PollResult>((resolve) => {
          release = resolve;
        }),
    );
    const loop = startLivePoll({
      rendered: () => 'A',
      onChange: vi.fn(),
      isVisible: () => true,
      poll,
      random: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    loop.wake();
    expect(poll).toHaveBeenCalledTimes(1);
    release({ kind: 'ok', fingerprint: 'A' });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('keeps the list and backs off on failure, then resets after one good poll', async () => {
    const h = harness([
      { kind: 'failed' },
      { kind: 'failed' },
      { kind: 'ok', fingerprint: 'A' },
      { kind: 'ok', fingerprint: 'A' },
    ]);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2 - 1);
    expect(h.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 4);
    expect(h.poll).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.poll).toHaveBeenCalledTimes(4);
    expect(h.onChange).not.toHaveBeenCalled();
    h.loop.stop();
  });

  it('does not poll a hidden tab and polls at once when it is shown again', async () => {
    const h = harness([{ kind: 'ok', fingerprint: 'B' }]);
    h.setVisible(false);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 4);
    expect(h.poll).not.toHaveBeenCalled();
    h.setVisible(true);
    h.loop.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.poll).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    h.loop.stop();
  });

  it('hands over to the server render on 401 and retries with backoff if the page stays', async () => {
    const h = harness([{ kind: 'signed-out' }, { kind: 'ok', fingerprint: 'A' }]);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2);
    expect(h.poll).toHaveBeenCalledTimes(2);
    h.loop.stop();
  });

  it('counts a poll that throws as a failure and keeps going', async () => {
    const poll = vi.fn<() => Promise<PollResult>>().mockRejectedValueOnce(new Error('boom'));
    poll.mockResolvedValue({ kind: 'ok', fingerprint: 'A' });
    const loop = startLivePoll({
      rendered: () => 'A',
      onChange: vi.fn(),
      isVisible: () => true,
      poll,
      random: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2);
    expect(poll).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('stop ends the loop and ignores an answer that arrives afterwards', async () => {
    let release: (value: PollResult) => void = () => undefined;
    const onChange = vi.fn();
    const loop = startLivePoll({
      rendered: () => 'A',
      onChange,
      isVisible: () => true,
      poll: () =>
        new Promise<PollResult>((resolve) => {
          release = resolve;
        }),
      random: () => 0.5,
    });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    loop.stop();
    release({ kind: 'ok', fingerprint: 'B' });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not re-render for an answer equal to a page that has since changed to match', async () => {
    const h = harness([{ kind: 'ok', fingerprint: 'B' }]);
    h.setRendered('B');
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    expect(h.onChange).not.toHaveBeenCalled();
    h.loop.stop();
  });
});

describe('isAttended', () => {
  it('stops counting a tab as attended after the idle window without input', () => {
    expect(isAttended(0, LIVE_IDLE_MS - 1)).toBe(true);
    expect(isAttended(0, LIVE_IDLE_MS)).toBe(false);
  });
});
