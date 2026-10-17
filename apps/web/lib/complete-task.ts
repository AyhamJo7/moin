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
 * match the contract is `failed`, never a locally invented success.
 */

import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  taskCompletePath,
  taskStateSchema,
} from '@moin/contracts';
import { t, type I18nKey } from './i18n.ts';

export type CompleteResult =
  /** The API committed the completion (or the task was already done at the version sent). */
  | { readonly kind: 'completed' }
  /** Someone changed the task first: nothing was written; the view must be reloaded. */
  | { readonly kind: 'conflict' }
  /** The task is gone for this owner: nothing was written; the view must be reloaded. */
  | { readonly kind: 'missing' }
  /** No valid session or no CSRF proof: the owner must sign in again. */
  | { readonly kind: 'signed-out' }
  /** The session may not do this. */
  | { readonly kind: 'forbidden' }
  /** Anything else: the outcome is unknown, so nothing is claimed. */
  | { readonly kind: 'failed' };

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
 * Ask the API to complete the task. `cookieHeader` is `document.cookie`; both it and `fetchImpl`
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
    return { kind: 'failed' };
  }
  switch (response.status) {
    case 200: {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'failed' };
      }
      const state = taskStateSchema.safeParse(body);
      return state.success && state.data.id === taskId && state.data.status === 'done'
        ? { kind: 'completed' }
        : { kind: 'failed' };
    }
    case 401:
      return { kind: 'signed-out' };
    case 403:
      return { kind: 'forbidden' };
    case 404:
      return { kind: 'missing' };
    case 409:
      return { kind: 'conflict' };
    default:
      return { kind: 'failed' };
  }
}

const MESSAGES: Readonly<Record<CompleteResult['kind'], I18nKey>> = {
  completed: 'today.complete.done',
  conflict: 'today.complete.conflict',
  missing: 'today.complete.missing',
  'signed-out': 'today.complete.signedOut',
  forbidden: 'today.complete.forbidden',
  failed: 'today.complete.failed',
};

/** The German sentence for an outcome: business language, no codes, no technical detail. */
export function completeMessage(result: CompleteResult): string {
  return t(MESSAGES[result.kind]);
}

/** Whether the server's view must be re-read: the action succeeded or the view was stale. */
export function needsRefresh(result: CompleteResult): boolean {
  return result.kind === 'completed' || result.kind === 'conflict' || result.kind === 'missing';
}
