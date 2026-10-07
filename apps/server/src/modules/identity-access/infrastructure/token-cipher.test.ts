import { randomBytes } from 'node:crypto';
import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../../../config/env.ts';
import { SealedValueError, TokenCipher, resolveTokenCipher } from './token-cipher.ts';

const PLAINTEXT = JSON.stringify({ idToken: 'eyJ.id.token', refreshToken: 'refresh-secret' });
const CONTEXT = 'moin/provider-tokens/v1:0192f0a0-0000-7000-8000-000000000001';

function cipher(): TokenCipher {
  return new TokenCipher(new Map([['k1', randomBytes(32)]]), 'k1');
}

describe('the provider-token cipher', () => {
  it('round-trips under the same context', () => {
    const c = cipher();
    expect(c.open(c.seal(PLAINTEXT, CONTEXT), CONTEXT)).toBe(PLAINTEXT);
  });

  evidenceTest('never stores the plaintext and never reuses an IV', () => {
    const c = cipher();
    const first = c.seal(PLAINTEXT, CONTEXT);
    const second = c.seal(PLAINTEXT, CONTEXT);
    for (const sealed of [first, second]) {
      expect(sealed.sealed.includes(Buffer.from('refresh-secret'))).toBe(false);
      expect(sealed.sealed.includes(Buffer.from('eyJ.id.token'))).toBe(false);
      expect(sealed.keyId).toBe('k1');
    }
    expect(first.sealed.subarray(0, 12).equals(second.sealed.subarray(0, 12))).toBe(false);
    expect(first.sealed.equals(second.sealed)).toBe(false);
  });

  evidenceTest('refuses any tampered byte', () => {
    const c = cipher();
    const sealed = c.seal(PLAINTEXT, CONTEXT);
    for (const index of [0, 11, 12, sealed.sealed.length - 17, sealed.sealed.length - 1]) {
      const tampered = Buffer.from(sealed.sealed);
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      expect(
        () => c.open({ keyId: 'k1', sealed: tampered }, CONTEXT),
        `byte ${String(index)}`,
      ).toThrow(SealedValueError);
    }
    expect(() => c.open({ keyId: 'k1', sealed: sealed.sealed.subarray(0, 20) }, CONTEXT)).toThrow(
      SealedValueError,
    );
  });

  evidenceTest('refuses a value sealed for another session or sign-in', () => {
    const c = cipher();
    const sealed = c.seal(PLAINTEXT, CONTEXT);
    expect(() => c.open(sealed, `${CONTEXT}x`)).toThrow(SealedValueError);
  });

  it('refuses an unknown key and a value sealed under another key', () => {
    const c = cipher();
    const sealed = c.seal(PLAINTEXT, CONTEXT);
    expect(() => c.open({ ...sealed, keyId: 'k2' }, CONTEXT)).toThrow(SealedValueError);
    expect(() => cipher().open(sealed, CONTEXT)).toThrow(SealedValueError);
  });

  it('opens values sealed under a retired key while sealing with the active one', () => {
    const old = randomBytes(32);
    const sealed = new TokenCipher(new Map([['k1', old]]), 'k1').seal(PLAINTEXT, CONTEXT);
    const rotated = new TokenCipher(
      new Map([
        ['k1', old],
        ['k2', randomBytes(32)],
      ]),
      'k2',
    );
    expect(rotated.open(sealed, CONTEXT)).toBe(PLAINTEXT);
    expect(rotated.seal(PLAINTEXT, CONTEXT).keyId).toBe('k2');
  });

  it('refuses a short key or an active key that is not in the ring', () => {
    expect(() => new TokenCipher(new Map([['k1', randomBytes(16)]]), 'k1')).toThrow(
      ConfigurationError,
    );
    expect(() => new TokenCipher(new Map([['k1', randomBytes(32)]]), 'k2')).toThrow(
      ConfigurationError,
    );
  });
});

describe('where the key comes from', () => {
  const base = {
    SERVER_ROLE: 'api',
    APP_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/moin',
  };

  evidenceTest('refuses staging and production until the KMS key source exists', () => {
    // Even holding local key material — which the loader already refuses there — a deployed
    // environment gets no cipher: the refusal is about where the key comes from, not whether one
    // happens to be present.
    const local = loadConfig({
      ...base,
      NODE_ENV: 'test',
      AUTH_LOCAL_TOKEN_KEY: 'local-v1:local-development-only',
    });
    for (const NODE_ENV of ['staging', 'production'] as const) {
      expect(() => resolveTokenCipher({ ...local, NODE_ENV }), NODE_ENV).toThrow(/KMS data key/);
    }
  });

  it('refuses the local key variable outside development and test at load time', () => {
    for (const NODE_ENV of ['staging', 'production']) {
      expect(() =>
        loadConfig({ ...base, NODE_ENV, AUTH_LOCAL_TOKEN_KEY: 'local-v1:local-development-only' }),
      ).toThrow(ConfigurationError);
    }
  });

  it('requires a local key in development and test, and derives a stable one from it', () => {
    expect(() => resolveTokenCipher(loadConfig({ ...base, NODE_ENV: 'test' }))).toThrow(
      ConfigurationError,
    );
    const config = loadConfig({
      ...base,
      NODE_ENV: 'test',
      AUTH_LOCAL_TOKEN_KEY: 'local-v1:local-development-only',
    });
    const sealed = resolveTokenCipher(config).seal(PLAINTEXT, CONTEXT);
    expect(sealed.keyId).toBe('local-v1');
    expect(resolveTokenCipher(config).open(sealed, CONTEXT)).toBe(PLAINTEXT);
  });

  it('never prints the local key', () => {
    let message = '';
    try {
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        AUTH_LOCAL_TOKEN_KEY: 'v1:do-not-print-me-0001',
      });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('AUTH_LOCAL_TOKEN_KEY');
    expect(message).not.toContain('do-not-print-me');
  });
});
