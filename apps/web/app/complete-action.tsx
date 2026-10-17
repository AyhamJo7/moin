'use client';

/**
 * The "Erledigt" button on a Heute card, and the page's one live region for action outcomes
 * (P13.03.02, M2A).
 *
 * The button never shows success on its own: it asks the API (`completeTask`) and reports what the
 * API committed. While the request is in flight it is `aria-disabled` and a second click does
 * nothing (a ref, not state, so two clicks in one frame cannot both pass). After a completion, a
 * conflict or a vanished task it re-reads the page from the server (`router.refresh`), so the list
 * the owner sees is the database's, not a local guess; the card of a completed task then leaves
 * the live list. The outcome sentence lives in `ActionNotice`, which sits outside every card and
 * therefore survives that refresh.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n.ts';
import { completeMessage, completeTask, needsRefresh } from '../lib/complete-task.ts';

const NOTICE_EVENT = 'action-notice';

export function ActionNotice() {
  const [message, setMessage] = useState('');
  const region = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const show = (event: Event): void => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') {
        setMessage(event.detail);
        // The card that held keyboard focus may be gone after the re-read: focus lands here, on
        // the outcome, not on the page body.
        region.current?.focus();
      }
    };
    window.addEventListener(NOTICE_EVENT, show);
    return () => {
      window.removeEventListener(NOTICE_EVENT, show);
    };
  }, []);
  return (
    <p
      ref={region}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="notice"
      data-testid="action-notice"
    >
      {message}
    </p>
  );
}

export function CompleteAction({
  taskId,
  title,
  version,
}: {
  taskId: string;
  title: string;
  version: number;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  async function onClick(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      const result = await completeTask(taskId, version, document.cookie);
      window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: completeMessage(result) }));
      if (needsRefresh(result)) router.refresh();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="action"
      aria-disabled={pending}
      aria-busy={pending}
      aria-label={`${t('today.complete.label')}: ${title}`}
      onClick={() => {
        void onClick();
      }}
    >
      {pending ? t('today.complete.pending') : t('today.complete.label')}
    </button>
  );
}
