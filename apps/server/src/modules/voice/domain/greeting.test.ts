/**
 * Call greeting (P12.01, INV-03, LG-V01): name present, disclosure first,
 * opening last, invalid greetings rejected.
 */
import { describe, expect, it } from 'vitest';
import { buildDisclosure } from './disclosure.ts';
import { buildGreeting, GREETING_OPENING, isValidGreeting } from './greeting.ts';

describe('call greeting', () => {
  it('contains the business name and the disclosure first', () => {
    const greeting = buildGreeting('dem Musterrestaurant');
    expect(greeting).toContain('dem Musterrestaurant');
    expect(greeting.startsWith(buildDisclosure('dem Musterrestaurant'))).toBe(true);
    expect(greeting.endsWith(GREETING_OPENING)).toBe(true);
    expect(greeting).toContain('KI-Assistent');
    expect(isValidGreeting(greeting, 'dem Musterrestaurant')).toBe(true);
  });

  it('rejects greetings with the wrong order or name', () => {
    expect(isValidGreeting('Womit kann ich Ihnen helfen?', 'dem Musterrestaurant')).toBe(false);
    expect(isValidGreeting(buildGreeting('dem Anderen'), 'dem Musterrestaurant')).toBe(false);
    expect(() => buildGreeting('')).toThrow();
  });
});
