'use client';

/**
 * Keeps an open Heute page current (P13.02.04, M2B): no markup of its own, it polls while the tab
 * is visible and asks the server to render the page again (`router.refresh`) when the list
 * changed. The render keeps client state, focus and the outcome line; cards are keyed by task id.
 * The mechanism and its limits are in `lib/live-today.ts`.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { startLivePoll } from '../lib/live-today.ts';

/** `fingerprint`: what the server rendered (`null` while it shows the error state). */
export function LiveToday({ fingerprint }: { fingerprint: string | null }) {
  const router = useRouter();
  // Read at poll time, so a new render is compared against without restarting the loop.
  const rendered = useRef(fingerprint);
  rendered.current = fingerprint;

  useEffect(() => {
    const poller = startLivePoll({
      rendered: () => rendered.current,
      onChange: () => {
        router.refresh();
      },
      isVisible: () => document.visibilityState === 'visible',
    });
    const wake = (): void => {
      poller.wake();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      poller.stop();
    };
  }, [router]);

  return null;
}
