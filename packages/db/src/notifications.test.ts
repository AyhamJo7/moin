/**
 * Notification channel resolution (P14.01.03): pure prefs logic — urgent-only,
 * quiet hours, urgent bypass. No DB; the integration test covers the rows.
 */
import { describe, expect, it } from 'vitest';
import { inQuietHours, resolveChannels, type NotificationPrefs } from './notifications.ts';

const BASE: NotificationPrefs = {
  channels: ['inapp', 'email', 'sms'],
  urgentOnly: false,
  quietFrom: '22:00',
  quietTo: '07:00',
  urgentBypass: false,
};

describe('notification prefs', () => {
  it('silences routine in quiet hours and urgent without bypass', () => {
    expect(resolveChannels(BASE, 'routine', '23:00')).toEqual([]);
    expect(resolveChannels(BASE, 'urgent', '23:00')).toEqual([]);
  });

  it('delivers urgent in quiet hours only for bypass contacts', () => {
    expect(resolveChannels({ ...BASE, urgentBypass: true }, 'urgent', '23:00')).toEqual([
      'inapp',
      'email',
      'sms',
    ]);
  });

  it('drops routine for urgent-only users and SMS for routine', () => {
    expect(resolveChannels({ ...BASE, urgentOnly: true }, 'routine', '12:00')).toEqual([]);
    expect(resolveChannels(BASE, 'routine', '12:00')).toEqual(['inapp', 'email']);
    expect(inQuietHours(BASE, '23:00')).toBe(true);
    expect(inQuietHours(BASE, '12:00')).toBe(false);
  });
});
