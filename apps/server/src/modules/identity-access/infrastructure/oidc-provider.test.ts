/**
 * The relying party against a real HTTP provider on loopback. Every rejection is asserted by its
 * kind and reason code, so a test cannot pass because some *other* check happened to fail.
 */
import { fixedClock } from '@moin/kernel';
import { evidenceTest } from '@moin/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeOidcProvider,
  type FakeOidcProvider,
} from '../__fixtures__/fake-oidc-provider.ts';
import { digestOf, pkceChallenge, randomSecret } from '../domain/secret-values.ts';
import { OidcError, OidcProviderClient } from './oidc-provider.ts';

const clock = fixedClock(new Date());
let provider: FakeOidcProvider;

beforeEach(async () => {
  clock.set(new Date());
  provider = await startFakeOidcProvider(clock);
});

afterEach(async () => {
  await provider.close();
});

const PERSON = { subject: 'f1c3a8e2-0000-4000-8000-000000000001', email: 'inhaber@example.test' };

/** Start, authorize and exchange, returning what verification needs. */
async function exchange(client = new OidcProviderClient(provider.config())) {
  const nonce = randomSecret();
  const verifier = randomSecret();
  const url = await client.authorizationUrl({
    state: randomSecret(),
    nonce,
    codeChallenge: pkceChallenge(verifier),
  });
  const { code } = provider.authorize(url, PERSON);
  const tokens = await client.exchangeCode(code, verifier);
  return { client, tokens, nonceHash: digestOf(nonce), verifier, url };
}

async function rejection(promise: Promise<unknown>): Promise<{ kind: string; reason: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OidcError) return { kind: error.kind, reason: error.reason };
    throw error;
  }
  // A matcher, not a thrown Error: accepting what must be refused is the assertion that fails.
  expect('accepted', 'expected a rejection').toBe('rejected');
  return { kind: 'accepted', reason: 'accepted' };
}

describe('the authorization request', () => {
  evidenceTest('asks for code + PKCE S256 with exactly the contract scopes', async () => {
    const client = new OidcProviderClient(provider.config());
    const url = new URL(
      await client.authorizationUrl({ state: 's', nonce: 'n', codeChallenge: 'c' }),
    );
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      response_type: 'code',
      client_id: 'moin-web',
      redirect_uri: 'http://localhost:3000/api/auth/callback',
      scope: 'openid email',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
    expect(url.origin + url.pathname).toBe(`${provider.issuer}/authorize`);
  });
});

describe('the code exchange', () => {
  evidenceTest('is server-side, client-authenticated and carries the verifier', async () => {
    const { verifier, tokens } = await exchange();
    expect(tokens.idToken.split('.')).toHaveLength(3);
    const [request] = provider.tokenRequests;
    expect(request?.authorization).toMatch(/^Basic /);
    expect(request?.body.get('grant_type')).toBe('authorization_code');
    expect(request?.body.get('code_verifier')).toBe(verifier);
    expect(request?.body.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
    expect(request?.body.get('client_secret')).toBeNull();
  });

  evidenceTest('fails closed when the provider refuses it', async () => {
    const client = new OidcProviderClient(provider.config());
    await client.metadata();
    expect(await rejection(client.exchangeCode('never-issued', randomSecret()))).toStrictEqual({
      kind: 'provider_rejected',
      reason: 'token_request_rejected',
    });
  });

  evidenceTest('fails closed on a provider error or an unreachable endpoint', async () => {
    const client = new OidcProviderClient(provider.config());
    await client.metadata();
    provider.tokenResponse = {
      status: 503,
      body: '{"error":"temporarily_unavailable","detail":"secret"}',
    };
    expect(await rejection(client.exchangeCode('c', randomSecret()))).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'token_endpoint_failed',
    });
    await provider.close();
    expect(await rejection(client.exchangeCode('c', randomSecret()))).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'token_endpoint_unreachable',
    });
    provider = await startFakeOidcProvider(clock);
  });

  evidenceTest('refuses a malformed token response', async () => {
    const client = new OidcProviderClient(provider.config());
    await client.metadata();
    for (const body of [
      'not json',
      '{}',
      '{"token_type":"Bearer","access_token":"a"}',
      '{"token_type":"mac","access_token":"a","id_token":"b"}',
    ]) {
      provider.tokenResponse = { status: 200, body };
      expect(await rejection(client.exchangeCode('c', randomSecret())), body).toStrictEqual({
        kind: 'token_invalid',
        reason: 'token_response_malformed',
      });
    }
  });
});

it('refuses a token response larger than any real one, without buffering it whole', async () => {
  const client = new OidcProviderClient(provider.config());
  await client.metadata();
  provider.tokenResponse = { status: 200, body: `{"pad":"${'x'.repeat(70_000)}"}` };
  expect(await rejection(client.exchangeCode('c', randomSecret()))).toStrictEqual({
    kind: 'token_invalid',
    reason: 'provider_response_too_large',
  });
});

describe('ID-token verification', () => {
  evidenceTest('accepts a token for this client, this issuer and this nonce', async () => {
    const { client, tokens, nonceHash } = await exchange();
    const { payload } = await client.verifyIdToken(tokens.idToken, nonceHash, clock.now());
    expect(payload.sub).toBe(PERSON.subject);
  });

  evidenceTest('a plain verification ignores a missing auth_time', async () => {
    provider.claims = { auth_time: undefined };
    const { client, tokens, nonceHash } = await exchange();
    const { payload } = await client.verifyIdToken(tokens.idToken, nonceHash, clock.now());
    expect(payload.sub).toBe(PERSON.subject);
  });

  evidenceTest('step-up accepts a fresh auth_time', async () => {
    const { client, tokens, nonceHash } = await exchange();
    const { payload } = await client.verifyIdToken(tokens.idToken, nonceHash, clock.now(), true);
    expect(payload.sub).toBe(PERSON.subject);
  });

  evidenceTest('step-up refuses a missing auth_time', async () => {
    provider.claims = { auth_time: undefined };
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now(), true)),
    ).toStrictEqual({ kind: 'token_invalid', reason: 'auth_time_missing' });
  });

  evidenceTest('step-up refuses a stale auth_time', async () => {
    provider.claims = { auth_time: Math.floor(clock.now().getTime() / 1000) - 600 };
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now(), true)),
    ).toStrictEqual({ kind: 'token_invalid', reason: 'auth_time_stale' });
  });

  evidenceTest('refuses the wrong nonce', async () => {
    const { client, tokens } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, digestOf(randomSecret()), clock.now())),
    ).toStrictEqual({ kind: 'token_invalid', reason: 'nonce_mismatch' });
  });

  evidenceTest('refuses a token without a nonce', async () => {
    provider.claims = { nonce: undefined };
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now())),
    ).toMatchObject({
      kind: 'token_invalid',
    });
  });

  evidenceTest('refuses a bad signature', async () => {
    provider.signing = 'foreign-key';
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now())),
    ).toStrictEqual({
      kind: 'token_invalid',
      reason: 'err_jws_signature_verification_failed',
    });
  });

  evidenceTest('refuses alg=none and HMAC', async () => {
    for (const signing of ['none', 'hs256'] as const) {
      provider.signing = signing;
      const { client, tokens, nonceHash } = await exchange();
      expect(
        await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now())),
        signing,
      ).toStrictEqual({ kind: 'token_invalid', reason: 'err_jose_alg_not_allowed' });
    }
  });

  evidenceTest('refuses the wrong issuer', async () => {
    provider.claims = { iss: 'http://127.0.0.1:1/realms/other' };
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now())),
    ).toStrictEqual({
      kind: 'token_invalid',
      reason: 'err_jwt_claim_validation_failed',
    });
  });

  evidenceTest('refuses a token for another client', async () => {
    // No `azp`, so the audience check is the only thing standing between this token and a session.
    provider.claims = { aud: 'moin-tests', azp: undefined };
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now())),
    ).toStrictEqual({
      kind: 'token_invalid',
      reason: 'err_jwt_claim_validation_failed',
    });
  });

  evidenceTest('refuses a token authorised for another party', async () => {
    provider.claims = { aud: ['moin-web', 'moin-tests'], azp: 'moin-tests' };
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(client.verifyIdToken(tokens.idToken, nonceHash, clock.now())),
    ).toStrictEqual({
      kind: 'token_invalid',
      reason: 'authorized_party_mismatch',
    });
    provider.claims = { aud: ['moin-web', 'moin-tests'], azp: undefined };
    const second = await exchange();
    expect(
      await rejection(
        second.client.verifyIdToken(second.tokens.idToken, second.nonceHash, clock.now()),
      ),
    ).toStrictEqual({ kind: 'token_invalid', reason: 'authorized_party_mismatch' });
  });

  evidenceTest('refuses an expired token, and one not yet valid', async () => {
    const { client, tokens, nonceHash } = await exchange();
    expect(
      await rejection(
        client.verifyIdToken(tokens.idToken, nonceHash, new Date(clock.now().getTime() + 400_000)),
      ),
    ).toStrictEqual({ kind: 'token_invalid', reason: 'err_jwt_expired' });

    provider.claims = { nbf: Math.floor(clock.now().getTime() / 1000) + 120 };
    const later = await exchange();
    expect(
      await rejection(
        later.client.verifyIdToken(later.tokens.idToken, later.nonceHash, clock.now()),
      ),
    ).toStrictEqual({ kind: 'token_invalid', reason: 'err_jwt_claim_validation_failed' });
  });

  it('refuses a malformed token', async () => {
    const { client, nonceHash } = await exchange();
    for (const token of ['', 'abc', 'a.b.c', 'eyJhbGciOiJSUzI1NiJ9..']) {
      expect(
        (await rejection(client.verifyIdToken(token, nonceHash, clock.now()))).kind,
        token,
      ).toBe('token_invalid');
    }
  });
});

describe('discovery', () => {
  evidenceTest('refuses a document naming another issuer', async () => {
    provider.discovery = { issuer: 'http://127.0.0.1:1/realms/other' };
    expect(await rejection(new OidcProviderClient(provider.config()).metadata())).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'discovery_issuer_mismatch',
    });
  });

  it('refuses a key set on another origin and endpoints off loopback for the local provider', async () => {
    provider.discovery = { jwks_uri: 'http://localhost:1/jwks' };
    expect(await rejection(new OidcProviderClient(provider.config()).metadata())).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'discovery_foreign_key_set',
    });
    provider.discovery = { token_endpoint: 'https://evil.example/token' };
    expect(await rejection(new OidcProviderClient(provider.config()).metadata())).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'discovery_endpoint_not_permitted',
    });
  });

  it('refuses plain-HTTP endpoints for a deployed provider', async () => {
    const config = { ...provider.config(), provider: 'cognito' as const };
    expect(await rejection(new OidcProviderClient(config).metadata())).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'discovery_endpoint_not_permitted',
    });
  });

  it('refuses a provider without PKCE S256', async () => {
    provider.discovery = { code_challenge_methods_supported: ['plain'] };
    expect(await rejection(new OidcProviderClient(provider.config()).metadata())).toStrictEqual({
      kind: 'provider_unavailable',
      reason: 'discovery_without_pkce_s256',
    });
  });

  it('retries after a failed discovery instead of caching the failure', async () => {
    provider.discovery = { issuer: 'http://127.0.0.1:1/realms/other' };
    const client = new OidcProviderClient(provider.config());
    await rejection(client.metadata());
    provider.discovery = {};
    await expect(client.metadata()).resolves.toBeDefined();
  });
});
