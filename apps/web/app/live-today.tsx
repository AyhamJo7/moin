'use client';

/**
 * Keeps an open Heute page current (P13.02.04, M2B): no markup of its own, it polls while the tab
 * is visible and asks the server to render the page again (`router.refresh`) when the list
 * changed. The render keeps client state, focus and the outcome line; cards are keyed by task id.
 * The mechanism and its limits are in `lib/live-today.ts`.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isAttended, startLivePoll } from '../lib/live-today.ts';

const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

/** `fingerprint`: what the server rendered (`null` while it shows the error state). */
export function LiveToday({ fingerprint }: { fingerprint: string | null }) {
  const router = useRouter();
  // Read at poll time, so a new render is compared against without restarting the loop.
  const rendered = useRef(fingerprint);
  useEffect(() => {
    rendered.current = fingerprint;
  }, [fingerprint]);

  useEffect(() => {
    let lastInput = Date.now();
    const poller = startLivePoll({
      rendered: () => rendered.current,
      onChange: () => {
        router.refresh();
      },
      isVisible: () => document.visibilityState === 'visible' && isAttended(lastInput, Date.now()),
    });
    const wake = (): void => {
      poller.wake();
    };
    // Input marks the owner as present; the first input after a pause polls at once.
    const input = (): void => {
      const paused = !isAttended(lastInput, Date.now());
      lastInput = Date.now();
      if (paused) poller.wake();
    };
    document.addEventListener('visibilitychange', wake);
    for (const type of INPUT_EVENTS) window.addEventListener(type, input, { passive: true });
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, input);
      window.removeEventListener('online', wake);
      poller.stop();
    };
  }, [router]);

  return null;
}
