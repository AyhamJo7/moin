/** CallSid dedup store (P11.03.04, INV-11): first write wins, replays read back. */
import { describe, expect, it } from 'vitest';
import { createInMemoryCallDedup } from './call-dedup.ts';

describe('call dedup', () => {
  it('claims once; duplicates keep the first outcome', async () => {
    const store = createInMemoryCallDedup();
    expect(await store.find('CA1')).toBeNull();
    await store.claim({ callSid: 'CA1', outcome: 'twiml-issued', token: 't1' });
    await store.claim({ callSid: 'CA1', outcome: 'twiml-issued', token: 't2' });
    expect(await store.find('CA1')).toStrictEqual({
      callSid: 'CA1',
      outcome: 'twiml-issued',
      token: 't1',
    });
    expect(store.size).toBe(1);
  });
});
