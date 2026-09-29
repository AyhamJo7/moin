import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  isValidBodyHash,
  isValidSignature,
  signatureBaseString,
  validateFormWebhook,
  validateJsonWebhook,
} from './validate.ts';

// Generated per run rather than written down. A 32-hex literal in a test file is indistinguishable
// from a real Twilio auth token — to a reader, to a scanner, and to anyone who copies the file as
// a starting point. The secret scanner flagged all three of these, and it was right to.
const AUTH_TOKEN = randomBytes(16).toString('hex');

describe('the published Twilio vector', () => {
  // Twilio documents this example with its expected signature. It is the only fixture here that
  // was not produced by this implementation, which makes it the only one that can catch the
  // implementation being self-consistently wrong — a sorted-wrong or concatenated-wrong base
  // string validates perfectly against itself.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = {
    CallSid: 'CA1234567890ABCDE',
    Caller: '+14158675309',
    Digits: '1234',
    From: '+14158675309',
    To: '+18005551212',
  };

  it('produces the documented signature', () => {
    expect(computeSignature('12345', url, params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });

  it('builds the documented base string: url then name+value in name order', () => {
    expect(signatureBaseString(url, params)).toBe(
      'https://mycompany.com/myapp.php?foo=1&bar=2' +
        'CallSidCA1234567890ABCDE' +
        'Caller+14158675309' +
        'Digits1234' +
        'From+14158675309' +
        'To+18005551212',
    );
  });

  it('is insensitive to the order the parameters were given in', () => {
    const reordered = {
      To: params.To,
      Digits: params.Digits,
      CallSid: params.CallSid,
      From: params.From,
      Caller: params.Caller,
    };
    expect(computeSignature('12345', url, reordered)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });
});

describe('isValidSignature', () => {
  const url = 'https://voice.example.de/voice/status?x=1';
  const params = { CallSid: 'CA9', CallStatus: 'completed' };
  const signature = computeSignature(AUTH_TOKEN, url, params);

  it('accepts a valid signature', () => {
    expect(isValidSignature({ authToken: AUTH_TOKEN, url, signature, params })).toBe(true);
  });

  it('rejects a tampered parameter value', () => {
    const tampered = { ...params, CallStatus: 'no-answer' };
    expect(isValidSignature({ authToken: AUTH_TOKEN, url, signature, params: tampered })).toBe(
      false,
    );
  });

  it('rejects an added parameter', () => {
    const extra = { ...params, TenantId: 'other-tenant' };
    expect(isValidSignature({ authToken: AUTH_TOKEN, url, signature, params: extra })).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const flipped = `A${signature.slice(1)}`;
    expect(isValidSignature({ authToken: AUTH_TOKEN, url, signature: flipped, params })).toBe(
      false,
    );
  });

  // The failure this catches in staging: the proxy says http, the configuration says https, and
  // every request is rejected with no clue why.
  it('rejects a signature computed for a different URL', () => {
    const other = 'http://voice.example.de/voice/status?x=1';
    expect(isValidSignature({ authToken: AUTH_TOKEN, url: other, signature, params })).toBe(false);
  });

  it('rejects a signature computed for a different query string', () => {
    const other = 'https://voice.example.de/voice/status?x=2';
    expect(isValidSignature({ authToken: AUTH_TOKEN, url: other, signature, params })).toBe(false);
  });

  it('rejects the wrong auth token', () => {
    expect(isValidSignature({ authToken: 'wrong-token', url, signature, params })).toBe(false);
  });

  it.each([
    ['an empty signature', { signature: '' }],
    ['an empty auth token', { authToken: '' }],
  ])('rejects %s', (_name, overrides) => {
    expect(isValidSignature({ authToken: AUTH_TOKEN, url, signature, params, ...overrides })).toBe(
      false,
    );
  });
});

describe('validateFormWebhook', () => {
  const url = 'https://voice.example.de/voice/session-end';
  const params = { SessionStatus: 'completed', HandoffData: '{"reasonCode":"completed"}' };

  it('accepts a correctly signed request', () => {
    const signature = computeSignature(AUTH_TOKEN, url, params);
    expect(validateFormWebhook({ authToken: AUTH_TOKEN, url, signature, params })).toStrictEqual({
      ok: true,
    });
  });

  it('reports a missing header rather than treating it as invalid input', () => {
    expect(
      validateFormWebhook({ authToken: AUTH_TOKEN, url, signature: undefined, params }),
    ).toStrictEqual({ ok: false, reason: 'missing-signature' });
  });

  it('rejects a bad signature', () => {
    expect(
      validateFormWebhook({ authToken: AUTH_TOKEN, url, signature: 'nope', params }),
    ).toStrictEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('validateJsonWebhook', () => {
  const body = JSON.stringify({ event: 'session.ended', callSid: 'CA9' });
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const url = `https://voice.example.de/voice/events?bodySHA256=${bodyHash}`;
  const signature = computeSignature(AUTH_TOKEN, url);

  it('accepts a signed URL whose body matches the committed hash', () => {
    expect(
      validateJsonWebhook({ authToken: AUTH_TOKEN, url, signature, rawBody: body }),
    ).toStrictEqual({ ok: true });
  });

  // The whole point of the body hash: the signature covers the URL, so without this check a
  // replayed URL accepts any body at all.
  it('rejects a body that does not match, even with a valid signature', () => {
    const swapped = JSON.stringify({ event: 'session.ended', callSid: 'CA-someone-else' });
    expect(
      validateJsonWebhook({ authToken: AUTH_TOKEN, url, signature, rawBody: swapped }),
    ).toStrictEqual({ ok: false, reason: 'bad-body-hash' });
  });

  it('rejects a URL that commits to no body hash', () => {
    const bare = 'https://voice.example.de/voice/events';
    expect(
      validateJsonWebhook({
        authToken: AUTH_TOKEN,
        url: bare,
        signature: computeSignature(AUTH_TOKEN, bare),
        rawBody: body,
      }),
    ).toStrictEqual({ ok: false, reason: 'missing-body-hash' });
  });

  it('reports a missing signature first', () => {
    expect(
      validateJsonWebhook({ authToken: AUTH_TOKEN, url, signature: undefined, rawBody: body }),
    ).toStrictEqual({ ok: false, reason: 'missing-signature' });
  });

  it('accepts the body as bytes as well as a string', () => {
    expect(
      validateJsonWebhook({
        authToken: AUTH_TOKEN,
        url,
        signature,
        rawBody: new TextEncoder().encode(body),
      }),
    ).toStrictEqual({ ok: true });
  });
});

describe('isValidBodyHash', () => {
  it('is case-insensitive about the hex it is given', () => {
    const body = 'x';
    const hex = createHash('sha256').update(body).digest('hex');
    expect(isValidBodyHash(body, hex.toUpperCase())).toBe(true);
  });

  it('rejects an empty expectation', () => {
    expect(isValidBodyHash('x', '')).toBe(false);
  });
});
