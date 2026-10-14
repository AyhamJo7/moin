/**
 * Accessibility helpers (P13.12.01): German labels, focus order, touch floor.
 */
import { describe, expect, it } from 'vitest';
import { focusOrder, meetsTouchFloor, MIN_TOUCH_PX, viewLabel } from './a11y.ts';

describe('owner-app a11y helpers', () => {
  it('labels every owner view in German without AI jargon', () => {
    const labels = focusOrder().map(viewLabel);
    expect(labels).toEqual(['Guten Morgen', 'Heute', 'Posteingang', 'Kunden', 'Wissen', 'Einstellungen']);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      expect(label.toLowerCase()).not.toContain('ki');
    }
  });

  it('orders keyboard focus morning-first, then nav order', () => {
    expect(focusOrder()[0]).toBe('morning');
    expect(focusOrder()).toHaveLength(6);
  });

  it('enforces the 44 px touch-target floor', () => {
    expect(MIN_TOUCH_PX).toBe(44);
    expect(meetsTouchFloor(44, 44)).toBe(true);
    expect(meetsTouchFloor(43, 44)).toBe(false);
    expect(meetsTouchFloor(44, 43)).toBe(false);
  });
});
