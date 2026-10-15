/**
 * Accessibility helpers (P13.12.01): German labels per owner view, keyboard
 * focus order, and the 44 px touch-target floor. Pure; components ride
 * separately.
 */
import type { OwnerView } from './states.ts';

/** German accessible label per owner view (P13.01.02 nav, no AI jargon). */
export function viewLabel(view: OwnerView): string {
  if (view === 'today') return 'Heute';
  if (view === 'inbox') return 'Posteingang';
  if (view === 'customers') return 'Kunden';
  if (view === 'knowledge') return 'Wissen';
  if (view === 'settings') return 'Einstellungen';
  return 'Guten Morgen';
}

/** Keyboard focus order: the nav order, morning banner first. */
export function focusOrder(): readonly OwnerView[] {
  return ['morning', 'today', 'inbox', 'customers', 'knowledge', 'settings'];
}

/** Minimum touch target edge in px (P13.01.04). */
export const MIN_TOUCH_PX = 44;

/** True when the target meets the 44 px floor on both axes. */
export function meetsTouchFloor(widthPx: number, heightPx: number): boolean {
  return widthPx >= MIN_TOUCH_PX && heightPx >= MIN_TOUCH_PX;
}
