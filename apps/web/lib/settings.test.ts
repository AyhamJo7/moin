/**
 * Owner settings (P13.08.01): prefs shape, verified-contacts gate.
 */
import { describe, expect, it } from 'vitest';
import { updatePrefs, verifiedContacts } from './settings.ts';

describe('owner settings', () => {
  it('updates prefs, dropping unknown channels', () => {
    expect(
      updatePrefs({ channels: ['sms'], urgentOnly: false }, ['sms', 'pager', 'email'], true),
    ).toStrictEqual({ channels: ['sms', 'email'], urgentOnly: true });
  });

  it('only verified escalation contacts notify', () => {
    const contacts = [
      { name: 'Anna', phone: '+49151', verified: true },
      { name: 'Ben', phone: '+49152', verified: false },
    ];
    expect(verifiedContacts(contacts).map((c) => c.name)).toStrictEqual(['Anna']);
  });
});
