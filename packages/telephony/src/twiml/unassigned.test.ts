/** Neutral unassigned TwiML (P11.01.03): fixed text, no tenant, ends the call. */
import { describe, expect, it } from 'vitest';
import { buildUnassignedTwiML, UNASSIGNED_MESSAGE } from './unassigned.ts';

describe('unassigned TwiML', () => {
  it('speaks the neutral sentence and hangs up', () => {
    expect(UNASSIGNED_MESSAGE).toBe('Diese Rufnummer ist derzeit nicht vergeben.');
    const twiml = buildUnassignedTwiML();
    expect(twiml).toContain(
      '<Say language="de-DE">Diese Rufnummer ist derzeit nicht vergeben.</Say>',
    );
    expect(twiml).toContain('<Hangup />');
    expect(twiml).not.toContain('ConversationRelay');
  });
});
