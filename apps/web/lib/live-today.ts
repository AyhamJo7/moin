/**
 * Live Heute (P13.02.04, M2B): how an already-open page learns that the owner's tasks changed.
 *
 * The mechanism is bounded polling of the same authenticated read the page renders from
 * (`GET /api/today`, session cookie, tenant from the session, INV-02), not a push channel: the
 * API has no event stream, and polling needs no new surface that could be subscribed to without
 * authorisation. The poll only compares: when the answer differs from what is on screen the
 * page asks the server to render again (`onChange`), so the list is always the server's own
 * rendering, never a client-side merge, and an unchanged answer costs the page nothing.
 *
 * Guarantees, under a healthy connection and a visible tab: a committed change is on screen
 * within one interval plus one request and one render (`LIVE_POLL_MS`, well under the 60 s of
 * P13.02.04). Not promised: a hidden or suspended tab, a stopped network or an expired session
 * (the next poll after the tab or network returns reads the current state instead).
 *
 * Polls never overlap (the next one is scheduled after the previous finished), a failed poll
 * leaves the list as it is and backs off, a 401 hands over to the server render (which shows the
 * signed-out state) and stops, and a hidden tab polls not at all.
 */

import { TODAY_PATH, todayResponseSchema, type TodayTask } from '@moin/contracts';

/** Time between polls of a visible tab. Per-account budget is 50 requests a minute. */
export const LIVE_POLL_MS = 15_000;

/** Longest wait after repeated failures. */
export const LIVE_BACKOFF_MAX_MS = 120_000;

/** One poll gives up after this long (a stuck request must not stall the loop). */
export const LIVE_REQUEST_TIMEOUT_MS = 8_000;

/**
 * A tab with no user input for this long stops polling. Every guarded read slides the session's
 * idle expiry, so polling without a person there would keep an abandoned screen signed in for the
 * session's whole absolute lifetime; the idle timeout must keep meaning "nobody is here".
 */
export const LIVE_IDLE_MS = 30 * 60_000;

/** Whether the last user input is recent enough for the tab to keep polling. */
export function isAttended(lastInputMs: number, nowMs: number): boolean {
  return nowMs - lastInputMs < LIVE_IDLE_MS;
}

/** +/- share of the delay randomised, so tabs opened together do not poll together. */
const JITTER_SHARE = 0.1;

/**
 * What identifies the rendered list: every field the page shows or acts on, in render order,
 * plus the truncation flag. Equal fingerprints mean the same page.
 */
export function fingerprintOf(tasks: readonly TodayTask[], truncated: boolean): string {
  return JSON.stringify([
    truncated,
    tasks.map((task) => [
      task.id,
      task.version,
      task.status,
      task.priority,
      task.type,
      task.title,
      task.callerNumber,
    ]),
  ]);
}

export type PollResult =
  | { readonly kind: 'ok'; readonly fingerprint: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'failed' };

/** One authenticated read of the live list. Anything unexpected is `failed`, never a state. */
export async function pollToday(fetchImpl: typeof fetch = fetch): Promise<PollResult> {
  let response: Response;
  try {
    response = await fetchImpl(TODAY_PATH, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status !== 200) return { kind: 'failed' };
  try {
    const parsed = todayResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'ok', fingerprint: fingerprintOf(parsed.data.tasks, parsed.data.truncated) }
      : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** Delay before the next poll: the interval, doubled per consecutive failure up to the cap. */
export function nextDelayMs(failures: number, random: () => number = Math.random): number {
  const base = Math.min(LIVE_POLL_MS * 2 ** failures, LIVE_BACKOFF_MAX_MS);
  return Math.round(base * (1 + JITTER_SHARE * (2 * random() - 1)));
}

export interface LivePollDeps {
  /** The fingerprint of what is on screen now; `null` while the page shows its error state. */
  readonly rendered: () => string | null;
  /** Ask the server to render the page again. */
  readonly onChange: () => void;
  readonly isVisible: () => boolean;
  readonly poll?: () => Promise<PollResult>;
  readonly random?: () => number;
}

/**
 * Start polling; returns the function that stops it. `wake` (tab visible again, network back)
 * polls at once instead of waiting out the timer.
 */
export function startLivePoll(deps: LivePollDeps): { stop: () => void; wake: () => void } {
  const poll = deps.poll ?? (() => pollToday());
  // An object, not bare lets: `stop` flips it while `tick` awaits, which flow analysis cannot see.
  const state = { stopped: false, running: false };
  const isStopped = (): boolean => state.stopped;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(): void {
    if (state.stopped) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        void tick();
      },
      nextDelayMs(failures, deps.random),
    );
  }

  async function tick(): Promise<void> {
    if (state.stopped || state.running) return;
    // A hidden tab does not poll; `wake` picks it up when it is shown again.
    if (!deps.isVisible()) return;
    state.running = true;
    let result: PollResult;
    try {
      result = await poll();
    } catch {
      result = { kind: 'failed' };
    } finally {
      state.running = false;
    }
    if (isStopped()) return;
    if (result.kind === 'signed-out') {
      // The server render decides what a 401 means (the signed-out page unmounts this loop); a
      // 401 the render does not confirm is retried like any failure, not trusted forever.
      deps.onChange();
      failures += 1;
    } else if (result.kind === 'failed') {
      failures += 1;
    } else {
      failures = 0;
      if (result.fingerprint !== deps.rendered()) deps.onChange();
    }
    schedule();
  }

  schedule();
  return {
    stop: () => {
      state.stopped = true;
      clearTimeout(timer);
    },
    wake: () => {
      if (state.stopped || state.running) return;
      clearTimeout(timer);
      void tick();
    },
  };
}
