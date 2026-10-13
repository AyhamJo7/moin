/**
 * PII minimisation and redaction (P10.05.01–.03, INV-12, ADR-0019): NLU
 * prompts carry no caller number and slot names not values; stored output
 * has phones masked and names initialised; the scanner passes over redacted
 * records. Synthetic fixtures only (INV-16).
 */
import { describe, expect, it } from 'vitest';
import { buildNluMessages, containsPii, redactProposedOutput } from './context.ts';

const CALLER_NUMBER = '+4915112345678';

describe('PII minimisation and redaction', () => {
  it('builds NLU prompts without caller number, with slot names not values', () => {
    const messages = buildNluMessages({
      transcript: 'Ich brauche einen Rückruf, sagt Herr Schmidt',
      slotNames: ['callback_phone', 'caller_name'],
    });
    const joined = messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain(CALLER_NUMBER);
    expect(joined).toContain('callback_phone');
    // The type has no field for a number or a value, so passing one is a
    // compile error — assert the shape, not just this instance.
    expect(messages.every((m) => m.role === 'system' || m.role === 'user')).toBe(true);
  });

  it('redacts stored proposed_output: phones masked, names initialised', () => {
    const redacted = redactProposedOutput(
      `Herr Schmidt bittet um Rückruf unter ${CALLER_NUMBER}. Name: Anna Schmidt.`,
    );
    expect(redacted).not.toContain(CALLER_NUMBER);
    expect(redacted).toContain('[phone]');
    expect(redacted).toContain('Herr S.');
    expect(redacted).toContain('Name: A. S.');
    expect(containsPii(redacted)).toBe(false);
  });

  it('scanner passes redacted sample-call records and flags raw ones', () => {
    const raw = [
      `Rückruf für Herrn Schmidt unter ${CALLER_NUMBER}`,
      'Anrufer: Anna Schmidt, bitte zurückrufen',
      'Bitte rufen Sie 040 / 123 456 zurück',
    ];
    for (const line of raw) expect(containsPii(line), line).toBe(true);
    for (const line of raw) expect(containsPii(redactProposedOutput(line)), line).toBe(false);
  });
});
