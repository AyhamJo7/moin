/**
 * Owner-app i18n (P13.01.03): German catalogue with a missing-key guard.
 * No AI jargon in keys or values (BR-060). The catalogue is the contract;
 * the CI missing-key check pins every key used in code.
 */

import de from '../messages/de.json' with { type: 'json' };

export type I18nKey = keyof typeof de;

export function t(key: I18nKey): string {
  return de[key];
}

/** All catalogue keys, for the missing-key check and locale switch. */
export function allKeys(): readonly I18nKey[] {
  return Object.keys(de) as I18nKey[];
}
