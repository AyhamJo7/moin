/**
 * The Today page's data path (P13.02, M1 vertical slice): load the owner's live tasks from the
 * API on the server, and map them to the page's sections and German labels.
 *
 * The page renders on the server. The owner's session cookie never reaches client script: the
 * server reads it from the incoming request and forwards only that one cookie to `GET
 * /api/today`, which resolves the organisation from it (INV-02). The browser holds no tenant id
 * and no database access; the response is parsed with the API's own contract schema, and a body
 * that does not match is an error state, never a half-rendered task.
 */

import {
  SESSION_COOKIE_NAME,
  TODAY_CONTRACT_HEADER,
  TODAY_CONTRACT_VERSIONED,
  TODAY_PATH,
  parseTodayBody,
  type ReadTodayTask,
} from '@moin/contracts';
import { t, type I18nKey } from './i18n.ts';
import type { TodaySection } from './today.ts';

/** How long the server waits for the API before showing the error state. */
export const TODAY_TIMEOUT_MS = 5_000;

/** Where sign-in starts; the API returns the browser to `/` afterwards. */
export const LOGIN_PATH = '/api/auth/login';

/** Tenant display zone until the organisation's own setting is served (P07.14). */
export const DISPLAY_TIME_ZONE = 'Europe/Berlin';

// The API mints the token as base64url of 32 bytes (43 characters). Anything else is not one of
// ours, and is never copied into an outgoing header.
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/**
 * The session bearer only travels over TLS, or to loopback in development and tests. Anything
 * else (plain http to a remote host, credentials or a path in the URL, an unparseable value) is
 * a configuration error, shown as the error state rather than sending the cookie.
 */
export function safeApiOrigin(apiOrigin: string | undefined): apiOrigin is string {
  if (apiOrigin === undefined || apiOrigin.length === 0 || !URL.canParse(apiOrigin)) return false;
  const url = new URL(apiOrigin);
  if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '') {
    return false;
  }
  return (
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))
  );
}

export type TodayLoad =
  | { readonly state: 'signed-out' }
  | {
      readonly state: 'ready';
      readonly tasks: readonly ReadTodayTask[];
      readonly truncated: boolean;
    }
  | { readonly state: 'error'; readonly reason: 'unconfigured' | 'unavailable' | 'contract' };

export const SECTION_ORDER: readonly TodaySection[] = [
  'urgent',
  'callbacks',
  'requests',
  'appointments',
  'questions',
];

/** P13.02.01 section names (documents stay hidden until P34, T-08). */
const SECTION_HEADINGS: Readonly<Record<TodaySection, I18nKey>> = {
  urgent: 'today.section.urgent',
  callbacks: 'today.section.callbacks',
  requests: 'today.section.requests',
  appointments: 'today.section.appointments',
  questions: 'today.section.questions',
};

const STATUS_LABELS: Readonly<Record<ReadTodayTask['status'], I18nKey>> = {
  open: 'today.status.open',
  in_progress: 'today.status.in_progress',
  waiting: 'today.status.waiting',
  done: 'today.status.done',
  cancelled: 'today.status.cancelled',
};

export function sectionHeading(section: TodaySection): string {
  return t(SECTION_HEADINGS[section]);
}

export function statusLabel(status: ReadTodayTask['status']): string {
  return t(STATUS_LABELS[status]);
}

/** Urgent first; then by kind. Nothing in this slice produces open questions yet. */
export function sectionOf(task: ReadTodayTask): TodaySection {
  if (task.priority === 'urgent') return 'urgent';
  if (task.type === 'callback') return 'callbacks';
  if (task.type === 'booking') return 'appointments';
  return 'requests';
}

/**
 * What a card offers for "Erledigt". Only a version the API itself sent can be presented back to
 * it: a task without one (an API that predates versions) is shown but cannot be completed, so the
 * optimistic lock is never skipped and a version is never guessed.
 */
export type CompleteControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'action'; readonly version: number }
  | { readonly kind: 'unavailable' };

export function completeControlOf(task: ReadTodayTask): CompleteControl {
  if (task.type !== 'callback') return { kind: 'none' };
  return task.version === null
    ? { kind: 'unavailable' }
    : { kind: 'action', version: task.version };
}

const CREATED_AT = new Intl.DateTimeFormat('de-DE', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "17.10.2026, 00:12" in the tenant's zone. */
export function formatCreatedAt(iso: string): string {
  return CREATED_AT.format(new Date(iso));
}

/**
 * Read the owner's Today tasks on the server. `sessionToken` is the value of the session cookie
 * from the incoming request, `apiOrigin` the API's internal origin. Fails closed: no or malformed
 * session → signed out; any transport failure, non-200/401 answer, or contract mismatch → error.
 */
export async function loadToday(
  sessionToken: string | undefined,
  apiOrigin: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<TodayLoad> {
  if (sessionToken === undefined || !SESSION_TOKEN.test(sessionToken)) {
    return { state: 'signed-out' };
  }
  if (!safeApiOrigin(apiOrigin)) return { state: 'error', reason: 'unconfigured' };
  let response: Response;
  try {
    response = await fetchImpl(new URL(TODAY_PATH, apiOrigin), {
      headers: {
        accept: 'application/json',
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        [TODAY_CONTRACT_HEADER]: TODAY_CONTRACT_VERSIONED,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(TODAY_TIMEOUT_MS),
    });
  } catch {
    return { state: 'error', reason: 'unavailable' };
  }
  if (response.status === 401) return { state: 'signed-out' };
  if (response.status !== 200) return { state: 'error', reason: 'unavailable' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: 'error', reason: 'contract' };
  }
  const parsed = parseTodayBody(body);
  if (parsed === null) return { state: 'error', reason: 'contract' };
  return { state: 'ready', tasks: parsed.tasks, truncated: parsed.truncated };
}
