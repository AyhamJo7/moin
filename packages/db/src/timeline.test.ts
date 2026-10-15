/**
 * Unified timeline (P28 SELL): merges + links + composes.
 */
import { describe, expect, it } from 'vitest';
import { composeDraft, erasedLine, identityKey, mergeTimeline } from './timeline.ts';

describe('unified customer timeline', () => {
  it('merges channels oldest-first with erased placeholders', () => {
    const merged = mergeTimeline([
      { atMs: 300, channel: 'task', refId: 't1', erased: false },
      { atMs: 100, channel: 'call', refId: 'c1', erased: false },
      { atMs: 200, channel: 'email', refId: 'e1', erased: true },
    ]);
    expect(merged.map((i) => i.channel)).toEqual(['call', 'email', 'task']);
    expect(erasedLine().length).toBeGreaterThan(0);
  });

  it('links identity on exact verified ids and composes drafts-only', () => {
    expect(identityKey('call', '+4915112345678')).toBe('call:+4915112345678');
    expect(identityKey('email', 'a@x.de')).toBe('email:a@x.de');
    expect(identityKey('task', 'x')).toBe(null);
    expect(identityKey('call', '  ')).toBe(null);
    const draft = composeDraft('t1', 'Danke für Ihre Nachricht.');
    expect(draft?.draftOnly).toBe(true);
    expect(composeDraft('', 'x')).toBe(null);
    expect(composeDraft('t1', '  ')).toBe(null);
  });
});
