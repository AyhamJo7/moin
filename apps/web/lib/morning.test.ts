/**
 * Morning summary (P13.09.01): banner line shape and sections present.
 */
import { describe, expect, it } from 'vitest';
import { buildMorningSummary, hasBreakdown } from './morning.ts';

describe('morning summary', () => {
  it('builds the banner with the handled/needs/back-office breakdown', () => {
    expect(buildMorningSummary({ handled: 12, needsAttention: 4, backOffice: 2 })).toStrictEqual({
      handled: 12,
      needsAttention: 4,
      backOffice: 2,
      total: 18,
      line: 'Guten Morgen. Seit Ladenschluss wurden 18 Kontakte bearbeitet.',
    });
  });

  it('shows the breakdown only when there is one', () => {
    expect(
      hasBreakdown(buildMorningSummary({ handled: 0, needsAttention: 0, backOffice: 0 })),
    ).toBe(false);
    expect(
      hasBreakdown(buildMorningSummary({ handled: 1, needsAttention: 0, backOffice: 0 })),
    ).toBe(true);
  });
});
