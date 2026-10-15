/**
 * Owner settings (P13.08.01): business profile + notification prefs +
 * escalation contacts as pure shapes. Persistence, audit and revocation
 * ride separately (P13.08.07 E2E).
 */

export interface BusinessProfile {
  readonly name: string;
  readonly street: string;
  readonly city: string;
}

export type NotifyChannel = 'sms' | 'call' | 'email';

export interface NotificationPrefs {
  readonly channels: readonly NotifyChannel[];
  readonly urgentOnly: boolean;
}

export interface EscalationContact {
  readonly name: string;
  readonly phone: string;
  readonly verified: boolean;
}

export interface OwnerSettings {
  readonly profile: BusinessProfile;
  readonly prefs: NotificationPrefs;
  readonly escalation: readonly EscalationContact[];
}

/** Update prefs; unknown channels are dropped, never stored. */
export function updatePrefs(
  current: NotificationPrefs,
  channels: readonly string[],
  urgentOnly: boolean,
): NotificationPrefs {
  const known: NotifyChannel[] = ['sms', 'call', 'email'];
  return {
    channels: known.filter((c) => channels.includes(c)),
    urgentOnly: urgentOnly && current.channels.length > 0 ? true : urgentOnly,
  };
}

/** Verified escalation contacts only — unverified numbers never notify. */
export function verifiedContacts(
  contacts: readonly EscalationContact[],
): readonly EscalationContact[] {
  return contacts.filter((c) => c.verified);
}
