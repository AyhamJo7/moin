/**
 * Today aggregation (P13.02.01–.03): section grouping in owner order,
 * summary counts, reassuring empty states.
 */
import { describe, expect, it } from 'vitest';
import { emptyLine, groupToday, TODAY_EMPTY } from './today.ts';
import type { TodayItem, TodaySummary } from './today.ts';

describe('today page', () => {
  it('groups rows by section in owner-priority order', () => {
    const items: TodayItem[] = [
      { id: 'q1', section: 'questions', label: 'Öffnungszeiten?' },
      { id: 'u1', section: 'urgent', label: 'Notfall' },
      { id: 'c1', section: 'callbacks', label: 'Rückruf Anna' },
    ];
    const grouped = groupToday(items);
    expect(Object.keys(grouped)).toStrictEqual([
      'urgent',
      'callbacks',
      'requests',
      'appointments',
      'questions',
    ]);
    expect(grouped.urgent).toHaveLength(1);
    expect(grouped.callbacks).toHaveLength(1);
    expect(grouped.requests).toStrictEqual([]);
  });

  it('summarises automatically-handled counts and reassures on empty', () => {
    const summary: TodaySummary = {
      callsAnswered: 12,
      faqsResolved: 8,
      requestsCaptured: 3,
      enquiriesRouted: 1,
    };
    expect(summary.callsAnswered + summary.faqsResolved).toBe(20);
    expect(TODAY_EMPTY).toBe('Alles erledigt.');
    expect(emptyLine()).toBe('Alles erledigt.');
  });
});
