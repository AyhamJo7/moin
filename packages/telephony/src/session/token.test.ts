import { describe, expect, it } from 'vitest';
import {
  SESSION_TOKEN_TTL_MS,
  consumeSessionToken,
  createInMemorySessionTokenStore,
  issueSessionToken,
} from './token.ts';

const NOW = Date.UTC(2026, 8, 29, 9, 0, 0);
const TENANT = 'a1b2c3d4-0000-4000-8000-000000000001';

describe('session tokens', () => {
  it('issues a token that resolves to its tenant', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, TENANT, NOW);
    expect(await consumeSessionToken(store, issued.token, NOW)).toStrictEqual({
      ok: true,
      tenantId: TENANT,
    });
  });

  // The property that makes a leaked TwiML document almost worthless: one connection, once.
  it('cannot be used twice', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, TENANT, NOW);
    expect((await consumeSessionToken(store, issued.token, NOW)).ok).toBe(true);
    expect(await consumeSessionToken(store, issued.token, NOW)).toStrictEqual({
      ok: false,
      reason: 'unknown-or-used',
    });
    expect(store.size).toBe(0);
  });

  it('expires exactly at the TTL boundary', async () => {
    const store = createInMemorySessionTokenStore();
    const a = await issueSessionToken(store, TENANT, NOW);
    expect((await consumeSessionToken(store, a.token, NOW + SESSION_TOKEN_TTL_MS - 1)).ok).toBe(
      true,
    );

    const b = await issueSessionToken(store, TENANT, NOW);
    expect(await consumeSessionToken(store, b.token, NOW + SESSION_TOKEN_TTL_MS)).toStrictEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a correct id with the wrong secret', async () => {
    const store = createInMemorySessionTokenStore();
    const issued = await issueSessionToken(store, TENANT, NOW);
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
    const issued = await issueSessionToken(store, TENANT, NOW);
    const secret = issued.token.slice(issued.token.indexOf('.') + 1);
    expect(issued.record.secretHash).not.toContain(secret);
    expect(JSON.stringify(issued.record)).not.toContain(secret);
  });

  it('issues distinct tokens', async () => {
    const store = createInMemorySessionTokenStore();
    const tokens = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      tokens.add((await issueSessionToken(store, TENANT, NOW)).token);
    }
    expect(tokens.size).toBe(64);
  });

  it('refuses to mint a token with no tenant', async () => {
    const store = createInMemorySessionTokenStore();
    await expect(issueSessionToken(store, '', NOW)).rejects.toThrow(/tenant id/u);
  });
});
