import { describe, expect, it } from 'vitest';
import { ALLOWED_FIELDS, REDACTED, redactToAllowlist } from './redaction.ts';

describe('INV-12 redaction allowlist', () => {
  it('passes allowlisted operational fields through unchanged', () => {
    const line = {
      level: 30,
      msg: 'call finished',
      requestId: 'req_01J',
      organisationId: 'org_01J',
      callId: 'call_01J',
      durationMs: 1234,
      statusCode: 200,
    };
    expect(redactToAllowlist(line)).toStrictEqual(line);
  });

  it('redacts personal data that a denylist would have to have named in advance', () => {
    const redacted = redactToAllowlist({
      requestId: 'req_01J',
      phone: '+4915112345678',
      email: 'anna.schmidt@example.de',
      name: undefined,
      callerName: 'Anna Schmidt',
      address: 'Musterstraße 1, 20095 Hamburg',
      transcript: 'Ich möchte einen Tisch für vier Personen',
    }) as Record<string, unknown>;

    expect(redacted['requestId']).toBe('req_01J');
    for (const key of ['phone', 'email', 'callerName', 'address', 'transcript']) {
      expect(redacted[key], `${key} must not reach the log`).toBe(REDACTED);
    }
  });

  it('redacts a field nobody has classified — the failure mode of forgetting is a redaction', () => {
    const redacted = redactToAllowlist({ somethingAddedNextYear: 'sensitive' }) as Record<
      string,
      unknown
    >;
    expect(redacted['somethingAddedNextYear']).toBe(REDACTED);
  });

  it('redacts nested personal data, not just the top level', () => {
    const redacted = redactToAllowlist({
      organisationId: 'org_01J',
      count: 1,
      outcome: { reason: 'no_answer', caller: { phone: '+4915112345678' } },
    }) as Record<string, Record<string, unknown>>;

    expect(redacted['outcome']?.['reason']).toBe('no_answer');
    expect(redacted['outcome']?.['caller']).toBe(REDACTED);
  });

  it('redacts inside arrays', () => {
    const redacted = redactToAllowlist({
      count: 2,
      items: [{ taskId: 't_1', note: 'ruft zurück wegen Heizung' }],
    }) as Record<string, unknown>;
    expect(redacted['items']).toBe(REDACTED);
  });

  it('keeps an error type and stack but never its message', () => {
    const error = new TypeError('no contact for +4915112345678');
    const redacted = redactToAllowlist({ err: error }) as Record<string, Record<string, unknown>>;

    expect(redacted['err']?.['type']).toBe('TypeError');
    expect(redacted['err']?.['message']).toBe(REDACTED);
    // The stack keeps its call frames but not V8's `<Name>: <message>` header, which would
    // otherwise smuggle the message back in.
    expect(String(redacted['err']?.['stack'])).toMatch(/^\s+at\s/);
    expect(String(redacted['err']?.['stack'])).not.toContain('no contact for');
    expect(JSON.stringify(redacted)).not.toContain('+4915112345678');
  });

  it('stops recursing on deeply nested input instead of hanging', () => {
    let deep: Record<string, unknown> = { organisationId: 'org_01J' };
    for (let i = 0; i < 50; i += 1) deep = { outcome: deep };
    expect(() => redactToAllowlist(deep)).not.toThrow();
    expect(JSON.stringify(redactToAllowlist(deep))).toContain(REDACTED);
  });

  it('does not allowlist any field that names a person, a number or message content', () => {
    for (const forbidden of [
      'phone',
      'email',
      'name',
      'firstName',
      'lastName',
      'address',
      'street',
      'postalCode',
      'transcript',
      'audio',
      'message',
      'body',
      'note',
      'caller',
      'contact',
      'password',
      'token',
      'secret',
      'authorization',
    ]) {
      expect(ALLOWED_FIELDS.has(forbidden), `${forbidden} must not be allowlisted`).toBe(false);
    }
  });
});
