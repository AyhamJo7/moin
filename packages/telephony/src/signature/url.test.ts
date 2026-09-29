import { describe, expect, it } from 'vitest';
import { OriginConfigError, reconstructRequestUrl } from './url.ts';

const ORIGIN = 'https://voice.example.de';

describe('reconstructRequestUrl', () => {
  it('joins the configured origin to the request target', () => {
    expect(
      reconstructRequestUrl({ publicOrigin: ORIGIN, originalUrl: '/voice/inbound' }),
    ).toStrictEqual({ url: 'https://voice.example.de/voice/inbound', mismatches: [] });
  });

  // Anything that normalises the query breaks validation for requests where the two spellings
  // differ — and only for those, which is why it survives a smoke test and fails in production.
  it('preserves the query string exactly, including order and encoding', () => {
    const target = '/voice/inbound?b=2&a=1&s=a%2Bb%20c';
    expect(reconstructRequestUrl({ publicOrigin: ORIGIN, originalUrl: target }).url).toBe(
      `https://voice.example.de${target}`,
    );
  });

  it('accepts a wss origin for the media socket', () => {
    expect(
      reconstructRequestUrl({ publicOrigin: 'wss://voice.example.de', originalUrl: '/relay' }).url,
    ).toBe('wss://voice.example.de/relay');
  });

  it('keeps a non-default port', () => {
    expect(
      reconstructRequestUrl({ publicOrigin: 'https://voice.example.de:8443', originalUrl: '/x' })
        .url,
    ).toBe('https://voice.example.de:8443/x');
  });

  it('reports, but does not act on, a proxy that disagrees with the configuration', () => {
    const result = reconstructRequestUrl({
      publicOrigin: ORIGIN,
      originalUrl: '/voice/inbound',
      forwardedProto: 'http',
      forwardedHost: 'attacker.example.com',
    });
    // The URL is the configured one. That is the security property: a header cannot move it.
    expect(result.url).toBe('https://voice.example.de/voice/inbound');
    expect(result.mismatches).toStrictEqual([
      { field: 'proto', configured: 'https', forwarded: 'http' },
      { field: 'host', configured: 'voice.example.de', forwarded: 'attacker.example.com' },
    ]);
  });

  it('reads only the client-facing entry of a proxy chain', () => {
    const result = reconstructRequestUrl({
      publicOrigin: ORIGIN,
      originalUrl: '/x',
      forwardedProto: 'https, http',
      forwardedHost: 'voice.example.de, internal.lb',
    });
    expect(result.mismatches).toStrictEqual([]);
  });

  it('treats absent forwarding headers as nothing to compare', () => {
    const result = reconstructRequestUrl({
      publicOrigin: ORIGIN,
      originalUrl: '/x',
      forwardedProto: undefined,
      forwardedHost: '',
    });
    expect(result.mismatches).toStrictEqual([]);
  });

  it.each([
    ['a non-URL origin', { publicOrigin: 'voice.example.de' }, /not a valid URL/u],
    ['an http origin', { publicOrigin: 'http://voice.example.de' }, /must be https: or wss:/u],
    ['an origin with a path', { publicOrigin: 'https://voice.example.de/api' }, /bare origin/u],
    ['an origin with a query', { publicOrigin: 'https://voice.example.de?a=1' }, /bare origin/u],
    ['a relative-less target', { originalUrl: 'voice/inbound' }, /must start with "\/"/u],
  ])('rejects %s', (_name, overrides, message) => {
    expect(() =>
      reconstructRequestUrl({ publicOrigin: ORIGIN, originalUrl: '/x', ...overrides }),
    ).toThrow(OriginConfigError);
    expect(() =>
      reconstructRequestUrl({ publicOrigin: ORIGIN, originalUrl: '/x', ...overrides }),
    ).toThrow(message);
  });
});
