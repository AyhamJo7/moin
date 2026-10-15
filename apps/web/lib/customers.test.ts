/**
 * Customers timeline (P13.05.01): per-customer chronological order plus
 * name lookup.
 */
import { describe, expect, it } from 'vitest';
import { customerTimeline, lookupCustomer } from './customers.ts';

describe('customers timeline', () => {
  it('orders one customer timeline oldest-first', () => {
    const entries = [
      { id: 't1', customerId: 'c1', atMs: 300, kind: 'task' as const, label: 'Rückruf' },
      { id: 'c1', customerId: 'c1', atMs: 100, kind: 'call' as const, label: 'Anruf' },
      { id: 'x1', customerId: 'c2', atMs: 50, kind: 'note' as const, label: 'Notiz' },
      { id: 'l1', customerId: 'c1', atMs: 200, kind: 'lead' as const, label: 'Anfrage' },
    ];
    expect(customerTimeline(entries, 'c1').map((e) => e.id)).toStrictEqual(['c1', 'l1', 't1']);
    expect(customerTimeline(entries, 'nobody')).toStrictEqual([]);
  });

  it('looks customers up by name, case-insensitive', () => {
    const customers = [
      { id: 'c1', name: 'Anna Schmidt' },
      { id: 'c2', name: 'Bäcker Müller' },
    ];
    expect(lookupCustomer(customers, 'anna')?.id).toBe('c1');
    expect(lookupCustomer(customers, 'MÜLLER')?.id).toBe('c2');
    expect(lookupCustomer(customers, 'zzz')).toBeNull();
  });
});
