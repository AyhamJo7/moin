/**
 * The owner's "Erledigt" action (P13.03.02, M2A): the browser side of `POST /api/tasks/:id/complete`.
 *
 * Runs in the browser, so it holds no session: the HttpOnly session cookie rides along on the
 * same-origin request by itself, and the only thing script reads is the CSRF synchronizer token
 * the API set for exactly this purpose (double submit, P06.06.06). The request names a task and
 * the version the owner saw; the tenant is the session's own on the API side (INV-02).
 *
 * The result is the API's answer and nothing else. A success is only ever a committed completion
 * the API confirmed with the shared contract; a network failure, a 5xx or an answer that does not
 * match the contract is never a locally invented success or failure: it is `unknown`, and a read
 * of the task decides whether the state can still be confirmed.
 */

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  taskCompletePath,
  taskPath,
  taskStateSchema,
} from '@moin/contracts';
import { t, type I18nKey } from './i18n.ts';

export type CompleteResult =
  /**
   * The task is done. `response`: the API's own answer said so. `readback`: the answer was lost
   * or unreadable and a following read of the task shows it done (the state is confirmed, whoever
   * wrote it).
   */
  | { readonly kind: 'completed'; readonly confirmedBy: 'response' | 'readback' }
  /** The API refused the request as malformed: nothing was written. */
  | { readonly kind: 'rejected' }
  /** Someone changed the task first: nothing was written; the view must be reloaded. */
  | { readonly kind: 'conflict' }
  /** The task is gone for this owner: nothing was written; the view must be reloaded. */
  | { readonly kind: 'missing' }
  /** No valid session or no CSRF proof: the owner must sign in again. */
  | { readonly kind: 'signed-out' }
  /** The session may not do this: nothing was written. */
  | { readonly kind: 'forbidden' }
  /**
   * The request was sent but its outcome cannot be established: the connection failed or timed
   * out, the answer was unusable, or the server failed. The completion may or may not have
   * committed, so neither success nor failure is claimed; the page is re-read.
   */
  | { readonly kind: 'unknown' };

/** How long the browser waits before the outcome is reported as unknown. */
export const COMPLETE_TIMEOUT_MS = 10_000;

const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The synchronizer token from `document.cookie`, or undefined when absent or malformed. */
export function readCsrfToken(cookieHeader: string): string | undefined {
  const values = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(`${CSRF_COOKIE_NAME}=`))
    .map((pair) => pair.slice(CSRF_COOKIE_NAME.length + 1));
  const [value] = values;
  return values.length === 1 && value !== undefined && CSRF_TOKEN.test(value) ? value : undefined;
}

/**
 * Ask the API to complete the task and report what is established: a confirmed success, a
 * confirmed rejection, or an unknown outcome (never a guessed failure). `cookieHeader` is `document.cookie`; both it and `fetchImpl`
 * are parameters so the outcomes can be tested without a browser.
 */
export async function completeTask(
  taskId: string,
  version: number,
  cookieHeader: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CompleteResult> {
  const token = readCsrfToken(cookieHeader);
  if (token === undefined) return { kind: 'signed-out' };
  let response: Response;
  try {
    response = await fetchImpl(taskCompletePath(taskId), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        [CSRF_HEADER_NAME]: token,
      },
      body: JSON.stringify({ version }),
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });
  } catch {
    return reconcile(taskId, fetchImpl);
  }
  switch (response.status) {
    case 200:
      return (await isDoneState(response, taskId))
        ? { kind: 'completed', confirmedBy: 'response' }
        : reconcile(taskId, fetchImpl);
    case 400:
      return { kind: 'rejected' };
    case 401:
      return { kind: 'signed-out' };
    case 403:
      return { kind: 'forbidden' };
    case 404:
      // Only the API's own "no such task" is a missing task. A bare 404 means the route is not
      // there (an API rolled back to before completion existed): the outcome is not established.
      return (await isProblem(response, NOT_FOUND_PROBLEM))
        ? { kind: 'missing' }
        : reconcile(taskId, fetchImpl);
    case 409:
      return { kind: 'conflict' };
    default:
      return reconcile(taskId, fetchImpl);
  }
}

/** The `type` of the API's problem answer for a task that does not exist for this owner. */
const NOT_FOUND_PROBLEM = '/problems/not-found';

async function isProblem(response: Response, type: string): Promise<boolean> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'type' in body && body.type === type;
  } catch {
    return false;
  }
}

/** Whether a response body is the contract's state of this very task, done. */
async function isDoneState(response: Response, taskId: string): Promise<boolean> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }
  const state = taskStateSchema.safeParse(body);
  return state.success && state.data.id === taskId && state.data.status === 'done';
}

/**
 * After an outcome the browser could not read, ask the API for the task. Only a task that reads as
 * done is a confirmed state. Anything else (still open, unreachable, unreadable) proves nothing: a
 * request still in flight on the server may yet commit, so the outcome stays `unknown`.
 */
async function reconcile(taskId: string, fetchImpl: typeof fetch): Promise<CompleteResult> {
  try {
    const response = await fetchImpl(taskPath(taskId), {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS),
    });
    if (response.status === 200 && (await isDoneState(response, taskId))) {
      return { kind: 'completed', confirmedBy: 'readback' };
    }
  } catch {
    // Unreachable as well: the outcome stays unknown.
  }
  return { kind: 'unknown' };
}

const MESSAGES: Readonly<Record<CompleteResult['kind'], I18nKey>> = {
  completed: 'today.complete.done',
  conflict: 'today.complete.conflict',
  missing: 'today.complete.missing',
  'signed-out': 'today.complete.signedOut',
  forbidden: 'today.complete.forbidden',
  rejected: 'today.complete.rejected',
  unknown: 'today.complete.unknown',
};

/** The German sentence for an outcome: business language, no codes, no technical detail. */
export function completeMessage(result: CompleteResult): string {
  return t(MESSAGES[result.kind]);
}

/**
 * Whether the server's view must be re-read: the action succeeded, the view was stale, or the
 * outcome is unknown. An unknown outcome (a lost response) may still have committed, and a retry
 * from the old card would then be refused as stale; re-reading shows the truth and hands the next
 * click the current version. Signed-out, forbidden and rejected change nothing, so the card stays as it is.
 */
export function needsRefresh(result: CompleteResult): boolean {
  return result.kind !== 'signed-out' && result.kind !== 'forbidden' && result.kind !== 'rejected';
}
