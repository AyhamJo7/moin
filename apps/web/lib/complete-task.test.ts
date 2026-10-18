/**
 * The owner's "Erledigt" client logic (P13.03.02, M2A): what the browser sends, and that it reports
 * only what is established: a confirmed success, a confirmed rejection, or an unknown outcome
 * (never a guessed failure). No browser needed: the cookie string and `fetch` are parameters.
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

type Step = { status: number; body: unknown } | 'network-error';

/** A fetch that plays the given steps in order (the POST first, then any read-back). */
function script(steps: Step[], seen: Seen[] = []): typeof fetch {
  let index = 0;
  return (input, init) => {
    seen.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const step = steps[index];
    index += 1;
    if (step === undefined || step === 'network-error') {
      return Promise.reject(new TypeError('network'));
    }
    const text = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    return Promise.resolve(new Response(text, { status: step.status }));
  };
}

const DONE = { id: TASK_ID, status: 'done', version: 4 };
const OPEN = { id: TASK_ID, status: 'open', version: 1 };

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

describe('completeTask: confirmed outcomes', () => {
  it('posts the task, the version and the echoed token to the same origin, and nothing more', async () => {
    const seen: Seen[] = [];
    const result = await completeTask(
      TASK_ID,
      1,
      COOKIES,
      script([{ status: 200, body: DONE }], seen),
    );
    expect(result).toStrictEqual({ kind: 'completed', confirmedBy: 'response' });
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
    const result = await completeTask(
      TASK_ID,
      1,
      'theme=dark',
      script([{ status: 200, body: DONE }], seen),
    );
    expect(result).toStrictEqual({ kind: 'signed-out' });
    expect(seen).toHaveLength(0);
  });

  it.each([
    [400, 'rejected'],
    [401, 'signed-out'],
    [403, 'forbidden'],
    [404, 'missing'],
    [409, 'conflict'],
  ] as const)('maps the explicit HTTP %i to %s without any read-back', async (status, kind) => {
    const seen: Seen[] = [];
    const body = status === 404 ? { type: '/problems/not-found' } : {};
    const result = await completeTask(TASK_ID, 1, COOKIES, script([{ status, body }], seen));
    expect(result).toStrictEqual({ kind });
    expect(seen).toHaveLength(1);
  });

  it('a bare 404 (the route is absent on an API rolled back) is unknown, never "the task is gone"', async () => {
    const seen: Seen[] = [];
    const nest = { statusCode: 404, message: `Cannot POST /api/tasks/${TASK_ID}/complete` };
    const result = await completeTask(
      TASK_ID,
      1,
      COOKIES,
      script(
        [
          { status: 404, body: nest },
          { status: 404, body: nest },
        ],
        seen,
      ),
    );
    expect(result).toStrictEqual({ kind: 'unknown' });
    expect(seen).toHaveLength(2);
  });
});

describe('completeTask: unknown outcomes are reconciled, never guessed', () => {
  it('commit then response loss: the read-back shows done, so the state is confirmed by the read', async () => {
    const seen: Seen[] = [];
    const result = await completeTask(
      TASK_ID,
      1,
      COOKIES,
      script(['network-error', { status: 200, body: DONE }], seen),
    );
    expect(result).toStrictEqual({ kind: 'completed', confirmedBy: 'readback' });
    expect(seen.map((s) => s.url)).toStrictEqual([
      `/api/tasks/${TASK_ID}/complete`,
      `/api/tasks/${TASK_ID}`,
    ]);
    expect(seen[1]?.init?.method).toBeUndefined();
  });

  it('a lost response whose read-back shows the task still open is unknown, not failed', async () => {
    const result = await completeTask(
      TASK_ID,
      1,
      COOKIES,
      script(['network-error', { status: 200, body: OPEN }]),
    );
    expect(result).toStrictEqual({ kind: 'unknown' });
  });

  it('a lost response and an unreachable read-back is unknown', async () => {
    expect(
      await completeTask(TASK_ID, 1, COOKIES, script(['network-error', 'network-error'])),
    ).toStrictEqual({ kind: 'unknown' });
  });

  it.each([429, 500, 502, 503, 504])(
    'HTTP %i is read back, and unknown when unconfirmed',
    async (status) => {
      const result = await completeTask(
        TASK_ID,
        1,
        COOKIES,
        script([
          { status, body: {} },
          { status: 200, body: OPEN },
        ]),
      );
      expect(result).toStrictEqual({ kind: 'unknown' });
    },
  );

  it('a 200 that is not this task done is read back before anything is claimed', async () => {
    const wrong: unknown[] = [
      {},
      'not json',
      { ...DONE, status: 'open' },
      { ...DONE, id: '11111111-1111-4111-8111-111111111111' },
      { ...DONE, extra: true },
    ];
    for (const body of wrong) {
      expect(
        await completeTask(
          TASK_ID,
          1,
          COOKIES,
          script([
            { status: 200, body },
            { status: 200, body: OPEN },
          ]),
        ),
      ).toStrictEqual({ kind: 'unknown' });
    }
  });

  it('a read-back that is not this task done confirms nothing', async () => {
    const result = await completeTask(
      TASK_ID,
      1,
      COOKIES,
      script([
        'network-error',
        { status: 200, body: { ...DONE, id: '11111111-1111-4111-8111-111111111111' } },
      ]),
    );
    expect(result).toStrictEqual({ kind: 'unknown' });
  });
});

describe('outcome wording and reconciliation', () => {
  const kinds: CompleteResult[] = [
    { kind: 'completed', confirmedBy: 'response' },
    { kind: 'completed', confirmedBy: 'readback' },
    { kind: 'rejected' },
    { kind: 'conflict' },
    { kind: 'missing' },
    { kind: 'signed-out' },
    { kind: 'forbidden' },
    { kind: 'unknown' },
  ];

  it('has a German sentence for every outcome and shows no code or technical term', () => {
    expect(allKeys()).toContain('today.complete.unknown');
    for (const result of kinds) {
      const text = completeMessage(result);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/\b(409|404|403|401|500|HTTP|API|Version|Fehlercode|undefined)\b/u);
    }
  });

  it('never calls an unknown outcome a failure, and never calls a rejection unknown', () => {
    expect(completeMessage({ kind: 'unknown' })).toBe(
      'Der aktuelle Stand konnte nicht bestätigt werden. Bitte prüfen Sie die aktualisierte Ansicht.',
    );
    expect(completeMessage({ kind: 'unknown' })).not.toMatch(/nicht geklappt|fehlgeschlagen/u);
    expect(completeMessage({ kind: 'completed', confirmedBy: 'readback' })).toBe(
      'Der Rückruf ist als erledigt markiert.',
    );
    expect(completeMessage({ kind: 'forbidden' })).toContain('zugewiesen');
  });

  it('re-reads the page unless nothing could have changed (signed out, forbidden, rejected)', () => {
    expect(kinds.filter((result) => needsRefresh(result)).map((r) => r.kind)).toStrictEqual([
      'completed',
      'completed',
      'conflict',
      'missing',
      'unknown',
    ]);
  });
});
