import { describe, expect, it } from 'vitest';
import { formParams } from './twilio-signature.guard.ts';

describe('formParams', () => {
  it('keeps the last value of a repeated field and stringifies the rest', () => {
    expect(formParams({ From: ['+491', 'anonymous'], Digits: 1 })).toStrictEqual({
      From: 'anonymous',
      Digits: '1',
    });
  });

  // A field the caller names `__proto__` must stay a key, never become the record's prototype.
  it('treats a field named __proto__ as an ordinary key', () => {
    const body = JSON.parse('{"__proto__": "x", "CallSid": "CA1"}') as unknown;
    const params = formParams(body);
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype);
    expect(Object.hasOwn(params, '__proto__')).toBe(true);
    expect(params['CallSid']).toBe('CA1');
  });

  it('reads a missing or non-object body as no fields', () => {
    expect(formParams(undefined)).toStrictEqual({});
    expect(formParams('CallSid=CA1')).toStrictEqual({});
  });
});
