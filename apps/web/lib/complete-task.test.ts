/**
 * The owner's "Erledigt" client logic (P13.03.02, M2A): what the browser sends, and that it reports
 * only what the API committed. No browser needed: the cookie string and `fetch` are parameters.
 */
import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@moin/contracts';
import { allKeys } from './i18n.ts';
import {
  completeMessage,
  completeTask,
  needsRefresh,
  readCsrfToken,
  type CompleteResult,
} from './complete-task.ts';

const TASK_ID = '6f0f8a2e-6a39-4f7b-9d0e-2d4c4b7f3a11';
const TOKEN = 'B'.repeat(40) + '_-9';
const COOKIES = `theme=dark; ${CSRF_COOKIE_NAME}=${TOKEN}`;

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function reply(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return (input, init) => {
    seen.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
  };
}

const DONE = { id: TASK_ID, status: 'done', version: 4 };

describe('readCsrfToken', () => {
  it('reads the synchronizer token and nothing else', () => {
    expect(readCsrfToken(COOKIES)).toBe(TOKEN);
    expect(readCsrfToken('')).toBeUndefined();
    expect(readCsrfToken(`${CSRF_COOKIE_NAME}=short`)).toBeUndefined();
    expect(
      readCsrfToken(`${CSRF_COOKIE_NAME}=${TOKEN}; ${CSRF_COOKIE_NAME}=${TOKEN}`),
    ).toBeUndefined();
    expect(readCsrfToken(`x${CSRF_COOKIE_NAME}=${TOKEN}`)).toBeUndefined();
  });
});

describe('completeTask', () => {
  it('posts the task, the version and the echoed token to the same origin, and nothing more', async () => {
    const seen: Seen[] = [];
    const result = await completeTask(TASK_ID, 1, COOKIES, reply(200, DONE, seen));
    expect(result).toStrictEqual({ kind: 'completed' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`/api/tasks/${TASK_ID}/complete`);
    const init = seen[0]?.init;
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe('{"version":1}');
    expect((init?.headers as Record<string, string>)[CSRF_HEADER_NAME]).toBe(TOKEN);
  });

  it('without a CSRF cookie sends nothing and says the owner is signed out', async () => {
    const seen: Seen[] = [];
    const result = await completeTask(TASK_ID, 1, 'theme=dark', reply(200, DONE, seen));
    expect(result).toStrictEqual({ kind: 'signed-out' });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [401, 'signed-out'],
    [403, 'forbidden'],
    [404, 'missing'],
    [409, 'conflict'],
    [429, 'failed'],
    [500, 'failed'],
    [503, 'failed'],
  ] as const)('maps HTTP %i to %s', async (status, kind) => {
    const result = await completeTask(TASK_ID, 1, COOKIES, reply(status, { status }));
    expect(result).toStrictEqual({ kind });
  });

  it('claims success only for a done task of the id asked for', async () => {
    const wrong: unknown[] = [
      {},
      'not json',
      { ...DONE, status: 'open' },
      { ...DONE, id: '11111111-1111-4111-8111-111111111111' },
      { ...DONE, extra: true },
    ];
    for (const body of wrong) {
      expect(await completeTask(TASK_ID, 1, COOKIES, reply(200, body))).toStrictEqual({
        kind: 'failed',
      });
    }
  });

  it('reports an unknown outcome when the network fails', async () => {
    const down: typeof fetch = () => Promise.reject(new TypeError('network'));
    expect(await completeTask(TASK_ID, 1, COOKIES, down)).toStrictEqual({ kind: 'failed' });
  });
});

describe('outcome wording and reconciliation', () => {
  const kinds: CompleteResult['kind'][] = [
    'completed',
    'conflict',
    'missing',
    'signed-out',
    'forbidden',
    'failed',
  ];

  it('has a German sentence for every outcome and shows no code or technical term', () => {
    const catalogue = allKeys();
    expect(catalogue).toContain('today.complete.label');
    for (const kind of kinds) {
      const text = completeMessage({ kind });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\b(409|404|403|401|500|HTTP|API|Version|Fehlercode|undefined)\b/u);
    }
  });

  it('re-reads the page unless nothing could have changed (signed out, forbidden)', () => {
    expect(kinds.filter((kind) => needsRefresh({ kind }))).toStrictEqual([
      'completed',
      'conflict',
      'missing',
      'failed',
    ]);
  });
});
