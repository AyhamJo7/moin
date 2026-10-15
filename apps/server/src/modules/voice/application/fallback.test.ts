/**
 * Fallback layers (P11.07.05, LG-V10, INV-19): each failure answers with a
 * spoken message + callback/human route; the full cascade ends hosted.
 */
import { describe, expect, it } from 'vitest';
import { afterReprompt, FALLBACK_APOLOGY, FALLBACK_CALLBACK_ASK, fallbackFor } from './fallback.ts';
import type { FailedLayer } from './fallback.ts';

describe('fallback layers', () => {
  it('each single failure triggers its layer (LG-V10)', () => {
    const cases: [FailedLayer, string][] = [
      ['nlu', 'deterministic-capture'],
      ['gateway', 'template-response'],
      ['stt', 'reprompt-then-capture'],
      ['ws', 'hosted-fallback'],
      ['db', 'deterministic-capture'],
      ['valkey', 'deterministic-capture'],
      ['app-down', 'hosted-fallback'],
      ['app-slow', 'hosted-fallback'],
    ];
    for (const [failure, layer] of cases) {
      expect(fallbackFor(new Set([failure])), failure).toMatchObject({ layer });
    }
  });

  it('full cascade ends hosted; German texts present (BR-129)', () => {
    const all: FailedLayer[] = ['nlu', 'gateway', 'stt', 'ws', 'db', 'valkey', 'app-down'];
    expect(fallbackFor(new Set(all))).toMatchObject({ layer: 'hosted-fallback' });
    expect(FALLBACK_APOLOGY).toContain('leid');
    expect(FALLBACK_CALLBACK_ASK).toContain('Drücken Sie die 1');
  });

  it('STT reprompts once, then captures', () => {
    const first = fallbackFor(new Set(['stt']));
    expect(first).toMatchObject({ layer: 'reprompt-then-capture', reprompted: false });
    const second = afterReprompt(first);
    expect(second).toMatchObject({ layer: 'reprompt-then-capture', reprompted: true });
    expect(afterReprompt(second)).toMatchObject({ layer: 'deterministic-capture' });
  });
});
