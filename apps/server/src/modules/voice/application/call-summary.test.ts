/**
 * Structured call summary (P12.13 brief slice, INV-08): drafts created
 * with topics/follow-ups, never servable as knowledge.
 */
import { describe, expect, it } from 'vitest';
import { draftSummary } from './call-summary.ts';

describe('call summary', () => {
  it('creates a draft with outcome, topics and follow-ups', () => {
    expect(draftSummary('CA1', 'callback-task', ['Öffnungszeiten'], ['Rückruf'])).toStrictEqual({
      callSid: 'CA1',
      outcome: 'callback-task',
      topics: ['Öffnungszeiten'],
      followUps: ['Rückruf'],
      servableAsKnowledge: false,
    });
  });

  it('summaries are never servable as knowledge (INV-08)', () => {
    const draft = draftSummary('CA1', 'completed', [], []);
    expect(draft.servableAsKnowledge).toBe(false);
    expect(draft.topics).toStrictEqual([]);
  });
});
