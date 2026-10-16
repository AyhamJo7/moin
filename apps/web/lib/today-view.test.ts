/**
 * Today data path (P13.02, M1): the server-side loader fails closed and forwards nothing but the
 * session cookie; tasks map to sections and German labels.
 */
import { describe, expect, it } from 'vitest';
import type { TodayTask } from '@moin/contracts';
import { allKeys } from './i18n.ts';
import {
  SECTION_ORDER,
  formatCreatedAt,
  loadToday,
  safeApiOrigin,
  sectionHeading,
  sectionOf,
  statusLabel,
} from './today-view.ts';

const TOKEN = 'A'.repeat(40) + '_-9';
const API = 'http://127.0.0.1:3101';

const TASK: TodayTask = {
  id: '6f0f8a2e-6a39-4f7b-9d0e-2d4c4b7f3a11',
  title: 'Rückruf: Tischreservierung',
  type: 'callback',
  status: 'open',
  priority: 'normal',
  createdAt: '2026-10-16T22:12:02.149Z',
  callerNumber: '+4915112345678',
};

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(respond: () => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  const impl: typeof fetch = async (input, init) => {
    seen.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return respond();
  };
  return impl;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadToday', () => {
  it('is signed out without a session or with a malformed one, and calls nothing', async () => {
    const seen: Seen[] = [];
    const never = fakeFetch(() => json(200, { tasks: [] }), seen);
    expect(await loadToday(undefined, API, never)).toStrictEqual({ state: 'signed-out' });
    expect(await loadToday('short', API, never)).toStrictEqual({ state: 'signed-out' });
    expect(await loadToday(`${TOKEN}\r\nx-tenant-id: b`, API, never)).toStrictEqual({
      state: 'signed-out',
    });
    expect(seen).toHaveLength(0);
  });

  it('forwards only the session cookie to the Today route, uncached', async () => {
    const seen: Seen[] = [];
    const result = await loadToday(
      TOKEN,
      API,
      fakeFetch(() => json(200, { tasks: [TASK], truncated: false }), seen),
    );
    expect(result).toStrictEqual({ state: 'ready', tasks: [TASK], truncated: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${API}/api/today`);
    expect(seen[0]?.init?.headers).toStrictEqual({
      accept: 'application/json',
      cookie: `__Host-moin_sid=${TOKEN}`,
    });
    expect(seen[0]?.init?.cache).toBe('no-store');
    expect(seen[0]?.init?.redirect).toBe('error');
  });

  it('maps 401 to signed out and every other failure to the error state', async () => {
    expect(
      await loadToday(
        TOKEN,
        API,
        fakeFetch(() => json(401, {})),
      ),
    ).toStrictEqual({
      state: 'signed-out',
    });
    expect(
      await loadToday(
        TOKEN,
        undefined,
        fakeFetch(() => json(200, {})),
      ),
    ).toStrictEqual({
      state: 'error',
      reason: 'unconfigured',
    });
    for (const status of [403, 404, 500, 503]) {
      expect(
        await loadToday(
          TOKEN,
          API,
          fakeFetch(() => json(status, {})),
        ),
      ).toStrictEqual({
        state: 'error',
        reason: 'unavailable',
      });
    }
    const refused = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await loadToday(TOKEN, API, refused)).toStrictEqual({
      state: 'error',
      reason: 'unavailable',
    });
  });

  it('refuses a body that does not match the contract', async () => {
    const drifted = [
      { tasks: [{ ...TASK, createdAt: 'yesterday' }], truncated: false },
      { tasks: [{ ...TASK, organisationId: 'b' }], truncated: false },
      { tasks: [TASK] },
      { items: [] },
      'not json at all',
    ];
    for (const body of drifted) {
      const response =
        typeof body === 'string' ? new Response(body, { status: 200 }) : json(200, body);
      expect(
        await loadToday(
          TOKEN,
          API,
          fakeFetch(() => response),
        ),
      ).toStrictEqual({
        state: 'error',
        reason: 'contract',
      });
    }
  });
});

describe('the API origin the session cookie may travel to', () => {
  it('accepts https and loopback http only', () => {
    expect(safeApiOrigin('https://api.internal.example')).toBe(true);
    expect(safeApiOrigin('http://127.0.0.1:3101')).toBe(true);
    expect(safeApiOrigin('http://localhost:3101')).toBe(true);
    for (const unsafe of [
      undefined,
      '',
      'not a url',
      'http://api.internal.example',
      'http://user:pass@127.0.0.1:3101',
      'https://api.internal.example/prefix',
      'ftp://127.0.0.1',
    ]) {
      expect(safeApiOrigin(unsafe), String(unsafe)).toBe(false);
    }
  });

  it('never sends the cookie to an unsafe origin', async () => {
    const seen: Seen[] = [];
    const result = await loadToday(
      TOKEN,
      'http://api.internal.example',
      fakeFetch(() => json(200, { tasks: [] }), seen),
    );
    expect(result).toStrictEqual({ state: 'error', reason: 'unconfigured' });
    expect(seen).toHaveLength(0);
  });
});

describe('Today mapping', () => {
  it('puts urgent first, callbacks under Rückrufe, bookings under appointments', () => {
    expect(sectionOf(TASK)).toBe('callbacks');
    expect(sectionOf({ ...TASK, priority: 'urgent' })).toBe('urgent');
    expect(sectionOf({ ...TASK, type: 'booking' })).toBe('appointments');
    expect(sectionOf({ ...TASK, type: null })).toBe('requests');
  });

  it('labels every section and status from the German catalogue', () => {
    expect(SECTION_ORDER.map(sectionHeading)).toStrictEqual([
      'Dringend',
      'Rückrufe',
      'Neue Anfragen',
      'Termine/Reservierungen zu bestätigen',
      'Offene Kundenfragen',
    ]);
    expect(statusLabel('open')).toBe('Offen');
    expect(statusLabel('in_progress')).toBe('In Bearbeitung');
    expect(allKeys()).toContain('today.status.cancelled');
  });

  it('shows the received time in the tenant zone', () => {
    // 22:12 UTC on 16 Oct is 00:12 on 17 Oct in Berlin (CEST, UTC+2).
    expect(formatCreatedAt(TASK.createdAt)).toBe('17.10.2026, 00:12');
  });
});
