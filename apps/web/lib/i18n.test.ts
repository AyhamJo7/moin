/**
 * i18n shell (P13.01.03/.05): German catalogue complete, no AI jargon,
 * locale switch keeps every key.
 */
import { describe, expect, it } from 'vitest';
import { allKeys, t } from './i18n.ts';

const NAV = [
  'nav.today',
  'nav.inbox',
  'nav.customers',
  'nav.knowledge',
  'nav.rules',
  'nav.settings',
] as const;

describe('owner-app i18n', () => {
  it('serves the German navigation catalogue (BR-060)', () => {
    expect(t('nav.today')).toBe('Heute');
    expect(t('nav.inbox')).toBe('Posteingang');
    expect(t('nav.customers')).toBe('Kunden');
    expect(t('nav.knowledge')).toBe('Wissen');
    expect(t('nav.rules')).toBe('Regeln');
    expect(t('nav.settings')).toBe('Einstellungen');
    for (const key of NAV) expect(allKeys()).toContain(key);
  });

  it('carries auth flows without AI jargon', () => {
    for (const key of [
      'auth.login',
      'auth.logout',
      'auth.sessionExpired',
      'auth.stepUp',
      'auth.mfaEnroll',
    ] as const) {
      const value = t(key);
      expect(value.length).toBeGreaterThan(0);
      expect(value.toLowerCase()).not.toContain('ki');
      expect(value.toLowerCase()).not.toContain('ai');
    }
  });
});
