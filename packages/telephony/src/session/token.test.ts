import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_TTL_MS,
  consumeSessionToken,
  createInMemorySessionTokenStore,
  issueSessionToken,
} from './token.ts';

const NOW = Date.UTC(2026, 8, 29, 9, 0, 0);
const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';
const CALL = 'CA00000000000000000000000000000001';
const BINDING = { tenantId: TENANT, callSid: CALL };

describe('session tokens', () => {
  it('issues a token that resolves to its tenant and call', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, BINDING, NOW);
    expect(await consumeSessionToken(store, issued.token, NOW)).toStrictEqual({
      ok: true,
      tenantId: TENANT,
      callSid: CALL,
    });
  });

  // The property that makes a leaked TwiML document almost worthless: one connection, once.
  it('cannot be used twice', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, BINDING, NOW);
    expect((await consumeSessionToken(store, issued.token, NOW)).ok).toBe(true);
    expect(await consumeSessionToken(store, issued.token, NOW)).toStrictEqual({
      ok: false,
      reason: 'unknown-or-used',
    });
    expect(store.size).toBe(0);
  });

  it('expires exactly at the TTL boundary', async () => {
    const store = createInMemorySessionTokenStore();
    const a = await issueSessionToken(store, BINDING, NOW);
    expect((await consumeSessionToken(store, a.token, NOW + SESSION_TOKEN_TTL_MS - 1)).ok).toBe(
      true,
    );

    const b = await issueSessionToken(store, BINDING, NOW);
    expect(await consumeSessionToken(store, b.token, NOW + SESSION_TOKEN_TTL_MS)).toStrictEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a correct id with the wrong secret', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, BINDING, NOW);
    const id = issued.token.slice(0, issued.token.indexOf('.'));
    expect(await consumeSessionToken(store, `${id}.wrong-secret`, NOW)).toStrictEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it.each([
    ['no separator', 'abcdef'],
    ['empty id', '.secret'],
    ['empty secret', 'id.'],
  ])('rejects a malformed token: %s', async (_name, token) => {
    const store = createInMemorySessionTokenStore();
    expect(await consumeSessionToken(store, token, NOW)).toStrictEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  // A store dump must not yield anything usable.
  it('stores a hash, never the secret', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, BINDING, NOW);
    const secret = issued.token.slice(issued.token.indexOf('.') + 1);
    expect(issued.record.secretHash).not.toContain(secret);
    expect(JSON.stringify(issued.record)).not.toContain(secret);
  });

  it('issues distinct tokens', async () => {
    const store = createInMemorySessionTokenStore();
    const tokens = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      tokens.add((await issueSessionToken(store, BINDING, NOW)).token);
    }
    expect(tokens.size).toBe(64);
  });

  it.each([
    ['no tenant', { tenantId: '', callSid: CALL }],
    ['no call', { tenantId: TENANT, callSid: '' }],
  ])('refuses to mint a token with %s', async (_name, binding) => {
    const store = createInMemorySessionTokenStore();
    await expect(issueSessionToken(store, binding, NOW)).rejects.toThrow(
      /tenant id and a CallSid/u,
    );
  });
});
