/**
 * Email channel (P27 SELL): groups + drafts.
 */
import { describe, expect, it } from 'vitest';
import { draftReply, normalizeSubject, threadGroups } from './email.ts';

describe('email channel', () => {
  it('groups threads by id or normalized subject', () => {
    const a = { messageId: 'm1', threadId: 't1', subject: 'Frage', from: 'a@x.de' };
    const b = { messageId: 'm2', threadId: 't1', subject: 'Re: Frage', from: 'b@x.de' };
    const c = { messageId: 'm3', threadId: null, subject: 'Rechnung', from: 'c@x.de' };
    const d = { messageId: 'm4', threadId: null, subject: 'AW: Rechnung', from: 'd@x.de' };
    const groups = threadGroups([a, b, c, d]);
    expect(groups['t1']).toHaveLength(2);
    expect(groups['subject:rechnung']).toHaveLength(2);
    expect(normalizeSubject('Re: AW: Hallo')).toBe('hallo');
  });

  it('creates drafts only, never sends', () => {
    const draft = draftReply({ messageId: 'm1', threadId: 't1', subject: 'Frage', from: 'a@x.de' });
    expect(draft.threadKey).toBe('t1');
    expect(draft.to).toBe('a@x.de');
    expect(draft.draftOnly).toBe(true);
    expect(draft.subject.startsWith('Re:')).toBe(true);
  });
});
