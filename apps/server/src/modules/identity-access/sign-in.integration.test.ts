/**
 * P06.06.01/.02 end to end: the API's sign-in routes against a real PostgreSQL as the NOBYPASSRLS
 * runtime role, and a real HTTP provider on loopback (`__fixtures__/fake-oidc-provider.ts`).
 *
 * Each negative case asserts the public answer *and* that no session row came into existence, so a
 * test cannot pass on the status code while the database says otherwise.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { fixedClock } from '@moin/kernel';
import { createTestDatabase, evidenceTest, type TestDatabase } from '@moin/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '../../config/config.module.ts';
import { loadConfig } from '../../config/env.ts';
import { LoggerModule } from '../../observability/logger.module.ts';
import { startFakeOidcProvider, type FakeOidcProvider } from './__fixtures__/fake-oidc-provider.ts';
import type { SessionService } from './application/session.service.ts';
import { providerTokensContext, verifierContext } from './application/sign-in.service.ts';
import { digestOf, pkceChallenge, randomSecret } from './domain/secret-values.ts';
import { IdentityAccessModule } from './identity-access.module.ts';
import { IDENTITY_CLOCK, SESSIONS } from './identity-access.tokens.ts';
import { resolveTokenCipher } from './infrastructure/token-cipher.ts';

const LOCAL_KEY = 'local-v1:local-development-only';
const SESSION_COOKIE_CONTRACT =
  /^__Host-moin_sid=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/; HttpOnly; Secure; SameSite=Lax$/;
const CLEARED_SIGN_IN = '__Host-moin_signin=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';

const clock = fixedClock(new Date());
let database: TestDatabase;

/** The api's second pool connects as moin_identity, exactly as deployed. */
function identityUrl(): string {
  const url = database.identityUrl;
  if (url === undefined) throw new Error('TEST_DATABASE_IDENTITY_URL is required');
  return url;
}
let admin: ReturnType<TestDatabase['fixturePool']>;
let provider: FakeOidcProvider;
let app: NestFastifyApplication;

function config(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    SERVER_ROLE: 'api',
    LOG_LEVEL: 'info',
    DATABASE_URL: database.appUrl,
    OIDC_PROVIDER: 'keycloak',
    OIDC_ISSUER_URL: provider.issuer,
    OIDC_CLIENT_ID: 'moin-web',
    OIDC_CLIENT_SECRET: 'local-development-only',
    OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
    AUTH_LOCAL_TOKEN_KEY: LOCAL_KEY,
    IDENTITY_DATABASE_URL: identityUrl(),
    ...env,
  });
}

async function build(env?: Record<string, string>): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot(config(env)), LoggerModule, IdentityAccessModule],
  })
    .overrideProvider(IDENTITY_CLOCK)
    .useValue(clock)
    .compile();
  const built = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await built.init();
  await built.getHttpAdapter().getInstance().ready();
  return built;
}

function setCookies(headers: Record<string, unknown>): string[] {
  const value = headers['set-cookie'];
  if (typeof value === 'string') return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

async function person(status: 'active' | 'disabled' = 'active') {
  const id = randomUUID();
  const subject = randomUUID();
  const email = `p-${subject.slice(0, 8)}@example.test`;
  await admin.query('insert into users (id, cognito_sub, email, status) values ($1, $2, $3, $4)', [
    id,
    subject,
    email,
    status,
  ]);
  return { id, subject, email };
}

async function sessionCount(): Promise<number> {
  const result = await admin.query<{ n: string }>('select count(*)::text as n from sessions');
  return Number(result.rows[0]?.n);
}

interface Started {
  readonly location: string;
  readonly binding: string;
}

async function login(returnTo?: string): Promise<Started> {
  const query = returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await app.inject({ method: 'GET', url: `/api/auth/login${query}` });
  expect(response.statusCode).toBe(302);
  const [cookie] = setCookies(response.headers);
  const binding =
    /^__Host-moin_signin=([A-Za-z0-9_-]{43}); Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/.exec(
      cookie ?? '',
    )?.[1];
  if (binding === undefined) throw new Error('no sign-in binding cookie');
  return { location: String(response.headers.location), binding };
}

async function callback(query: Record<string, string>, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/auth/callback?${new URLSearchParams(query).toString()}`,
    headers: cookie === undefined ? {} : { cookie },
  });
}

/** The whole browser round trip for `who`, with extra cookies the browser already holds. */
async function signIn(
  who: { subject: string; email: string },
  extraCookie = '',
  returnTo?: string,
) {
  const started = await login(returnTo);
  const { code, state } = provider.authorize(started.location, who);
  const response = await callback(
    { state, code, iss: provider.issuer },
    `__Host-moin_signin=${started.binding}${extraCookie === '' ? '' : `; ${extraCookie}`}`,
  );
  const sessionCookie = setCookies(response.headers).find((c) => c.startsWith('__Host-moin_sid='));
  const token = SESSION_COOKIE_CONTRACT.exec(sessionCookie ?? '')?.[1];
  return { response, token, state, code, started };
}

function sessions(): SessionService {
  return app.get<SessionService>(SESSIONS);
}

beforeAll(async () => {
  database = await createTestDatabase('signin');
  admin = database.fixturePool();
  // The expiry tests move the application clock past the database's; this private database
  // widens the bound the migration sets (five minutes), which `identity-store` tests at its value.
  await admin.query("update session_clock_policy set max_skew = interval '1 day'");
  provider = await startFakeOidcProvider(clock);
  app = await build();
});

afterAll(async () => {
  await app.close();
  await provider.close();
  await database.drop();
});

beforeEach(() => {
  clock.set(new Date());
  provider.claims = {};
  provider.signing = 'valid';
  provider.tokenResponse = undefined;
  provider.discovery = {};
});

afterEach(() => {
  provider.claims = {};
});

describe('signing in', () => {
  evidenceTest('issues one opaque session cookie and redirects to the stored path', async () => {
    const who = await person();
    const { response, token } = await signIn(who, '', '/today');
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/today');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.body).toBe('');
    const cookies = setCookies(response.headers);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(SESSION_COOKIE_CONTRACT);
    expect(cookies[1]).toBe(CLEARED_SIGN_IN);
    expect(Number(SESSION_COOKIE_CONTRACT.exec(cookies[0] ?? '')?.[2])).toBe(7 * 24 * 3600);

    const resolved = await sessions().resolve(token);
    expect(resolved?.userId).toBe(who.id);
  });

  evidenceTest(
    'starts with PKCE S256, a fresh state and nonce, and the contract scopes',
    async () => {
      const { location } = await login();
      const url = new URL(location);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url.searchParams.get('scope')).toBe('openid email');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
      expect(url.searchParams.has('code_verifier')).toBe(false);
      const second = new URL((await login()).location);
      expect(second.searchParams.get('state')).not.toBe(url.searchParams.get('state'));
      expect(second.searchParams.get('nonce')).not.toBe(url.searchParams.get('nonce'));
    },
  );

  evidenceTest('keeps state, nonce and verifier out of the pending row', async () => {
    const { location } = await login();
    const url = new URL(location);
    const state = url.searchParams.get('state') ?? '';
    const nonce = url.searchParams.get('nonce') ?? '';
    const row = await admin.query<{
      state_hash: Buffer;
      nonce_hash: Buffer;
      verifier_sealed: Buffer;
      key_id: string;
    }>(
      'select state_hash, nonce_hash, verifier_sealed, key_id from auth_transactions where state_hash = $1',
      [digestOf(state)],
    );
    const pending = row.rows[0];
    expect(pending?.nonce_hash).toStrictEqual(digestOf(nonce));
    const raw = JSON.stringify(row.rows[0]);
    expect(raw).not.toContain(state);
    expect(raw).not.toContain(nonce);
    // The sealed value is the verifier behind this request's S256 challenge, and only opens for it.
    const verifier = resolveTokenCipher(config()).open(
      { keyId: pending?.key_id ?? '', sealed: pending?.verifier_sealed ?? Buffer.alloc(0) },
      verifierContext(digestOf(state)),
    );
    expect(pkceChallenge(verifier)).toBe(url.searchParams.get('code_challenge'));
    expect(pending?.verifier_sealed.includes(Buffer.from(verifier))).toBe(false);
  });

  evidenceTest('stores only the token digest and sealed provider tokens', async () => {
    const who = await person();
    const { token } = await signIn(who);
    if (token === undefined) throw new Error('no session token');
    const issued = provider.responses.at(-1);
    const row = await admin.query<{
      id: string;
      token_hash: Buffer;
      provider_tokens_sealed: Buffer;
      provider_tokens_key_id: string;
      family_id: string;
    }>('select * from sessions where user_id = $1', [who.id]);
    const stored = row.rows[0];
    expect(stored?.token_hash).toStrictEqual(createHash('sha256').update(token).digest());

    const everything =
      JSON.stringify(row.rows) + (stored?.provider_tokens_sealed.toString('latin1') ?? '');
    for (const secret of [token, issued?.idToken, issued?.accessToken, issued?.refreshToken]) {
      expect(everything).not.toContain(secret);
    }
    const opened = JSON.parse(
      resolveTokenCipher(config()).open(
        {
          keyId: stored?.provider_tokens_key_id ?? '',
          sealed: stored?.provider_tokens_sealed ?? Buffer.alloc(0),
        },
        providerTokensContext(stored?.family_id ?? ''),
      ),
    ) as Record<string, unknown>;
    expect(opened).toMatchObject({
      idToken: issued?.idToken,
      accessToken: issued?.accessToken,
      refreshToken: issued?.refreshToken,
    });
  });

  evidenceTest('never hands a provider token, code or state to the browser', async () => {
    const who = await person();
    const { response, code, state } = await signIn(who);
    const issued = provider.responses.at(-1);
    const visible = JSON.stringify(response.headers) + response.body;
    for (const secret of [
      issued?.idToken,
      issued?.accessToken,
      issued?.refreshToken,
      code,
      state,
    ]) {
      expect(visible).not.toContain(secret);
    }
    expect(visible).not.toContain(who.subject);
    expect(visible).not.toContain(who.email);
  });

  it('ignores tenant, role and permission claims the provider adds', async () => {
    const who = await person();
    provider.claims = {
      organisation_id: randomUUID(),
      tenant_id: randomUUID(),
      role: 'owner',
      roles: ['owner'],
      permissions: ['billing_admin'],
      realm_access: { roles: ['owner'] },
      'cognito:groups': ['owners'],
      'custom:tenant': 'other',
    };
    const { response, token } = await signIn(who);
    expect(response.statusCode).toBe(302);
    const resolved = await sessions().resolve(token);
    expect(Object.keys(resolved ?? {}).sort()).toStrictEqual([
      'absoluteExpiresAt',
      'idleExpiresAt',
      'sessionId',
      'userId',
    ]);
  });
});

describe('a callback that must fail closed', () => {
  async function refused(
    expectStatus: number,
    run: () => Promise<{ statusCode: number; headers: Record<string, unknown>; body: string }>,
  ): Promise<void> {
    const before = await sessionCount();
    const response = await run();
    expect(response.statusCode).toBe(expectStatus);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(setCookies(response.headers)).toStrictEqual([CLEARED_SIGN_IN]);
    expect(Object.keys(JSON.parse(response.body) as object).sort()).toStrictEqual([
      'status',
      'title',
      'type',
    ]);
    expect(await sessionCount()).toBe(before);
  }

  evidenceTest('missing state', async () => {
    const started = await login();
    const { code } = provider.authorize(started.location, await person());
    await refused(400, () => callback({ code }, `__Host-moin_signin=${started.binding}`));
  });

  evidenceTest('unknown state', async () => {
    const started = await login();
    const { code } = provider.authorize(started.location, await person());
    await refused(400, () =>
      callback({ code, state: randomSecret() }, `__Host-moin_signin=${started.binding}`),
    );
  });

  evidenceTest('expired state', async () => {
    const started = await login();
    const { code, state } = provider.authorize(started.location, await person());
    clock.advance(10 * 60_000);
    await refused(400, () => callback({ code, state }, `__Host-moin_signin=${started.binding}`));
  });

  evidenceTest('replayed state', async () => {
    const who = await person();
    const first = await signIn(who);
    expect(first.response.statusCode).toBe(302);
    await refused(400, () =>
      callback(
        { code: first.code, state: first.state },
        `__Host-moin_signin=${first.started.binding}`,
      ),
    );
  });

  evidenceTest('concurrent duplicate callbacks create one session', async () => {
    const who = await person();
    const started = await login();
    const { code, state } = provider.authorize(started.location, who);
    const before = await sessionCount();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        callback({ code, state }, `__Host-moin_signin=${started.binding}`),
      ),
    );
    expect(responses.filter((r) => r.statusCode === 302)).toHaveLength(1);
    expect(await sessionCount()).toBe(before + 1);
  });

  evidenceTest('another browser presenting a valid state', async () => {
    const started = await login();
    const { code, state } = provider.authorize(started.location, await person());
    await refused(400, () => callback({ code, state }));
    // …and the probe burnt it: the right browser cannot finish afterwards.
    await refused(400, () => callback({ code, state }, `__Host-moin_signin=${started.binding}`));

    // The same with a binding of its own, which is what an attacker's browser would hold.
    const second = await login();
    const other = await login();
    const issued = provider.authorize(second.location, await person());
    await refused(400, () => callback(issued, `__Host-moin_signin=${other.binding}`));
    await refused(400, () => callback(issued, `__Host-moin_signin=${second.binding}`));
  });

  evidenceTest('missing code', async () => {
    const started = await login();
    const { state } = provider.authorize(started.location, await person());
    await refused(400, () => callback({ state }, `__Host-moin_signin=${started.binding}`));
  });

  evidenceTest('provider error, which also burns the state', async () => {
    const started = await login();
    const { code, state } = provider.authorize(started.location, await person());
    await refused(400, () =>
      callback({ state, error: 'access_denied' }, `__Host-moin_signin=${started.binding}`),
    );
    await refused(400, () => callback({ code, state }, `__Host-moin_signin=${started.binding}`));
  });

  it('a callback naming another issuer', async () => {
    const started = await login();
    const { code, state } = provider.authorize(started.location, await person());
    await refused(400, () =>
      callback(
        { code, state, iss: 'http://127.0.0.1:1/realms/other' },
        `__Host-moin_signin=${started.binding}`,
      ),
    );
  });

  it('repeated parameters', async () => {
    const started = await login();
    const { code, state } = provider.authorize(started.location, await person());
    await refused(400, () =>
      app.inject({
        method: 'GET',
        url: `/api/auth/callback?state=${state}&state=${state}&code=${code}`,
        headers: { cookie: `__Host-moin_signin=${started.binding}` },
      }),
    );
  });

  evidenceTest('a failed token endpoint', async () => {
    const who = await person();
    provider.tokenResponse = {
      status: 500,
      body: '{"error":"server_error","error_description":"x"}',
    };
    await refused(502, async () => (await signIn(who)).response);
  });

  evidenceTest('a malformed token endpoint response', async () => {
    const who = await person();
    provider.tokenResponse = { status: 200, body: '{"token_type":"Bearer"}' };
    await refused(400, async () => (await signIn(who)).response);
  });

  evidenceTest('a token the provider signed with another key', async () => {
    const who = await person();
    provider.signing = 'foreign-key';
    await refused(400, async () => (await signIn(who)).response);
  });

  evidenceTest('a token with the wrong nonce', async () => {
    const who = await person();
    provider.claims = { nonce: randomSecret() };
    await refused(400, async () => (await signIn(who)).response);
  });

  evidenceTest('an unverified email, refused by the canonical parser', async () => {
    const who = await person();
    provider.claims = { email_verified: false };
    await refused(400, async () => (await signIn(who)).response);
  });

  evidenceTest('a subject with no user row: sign-in never provisions one', async () => {
    const stranger = { subject: randomUUID(), email: 'fremd@example.test' };
    await refused(403, async () => (await signIn(stranger)).response);
    const users = await admin.query('select 1 from users where cognito_sub = $1', [
      stranger.subject,
    ]);
    expect(users.rowCount).toBe(0);
  });

  it('a disabled user', async () => {
    const disabled = await person('disabled');
    await refused(403, async () => (await signIn(disabled)).response);
  });
});

describe('starting a sign-in', () => {
  evidenceTest('refuses an external return target and writes nothing', async () => {
    const before = await admin.query<{ n: string }>(
      'select count(*)::text as n from auth_transactions',
    );
    for (const target of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/%2f%2fevil',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/auth/login?returnTo=${encodeURIComponent(target)}`,
      });
      expect(response.statusCode, target).toBe(400);
      expect(response.headers['set-cookie'], target).toBeUndefined();
    }
    const after = await admin.query<{ n: string }>(
      'select count(*)::text as n from auth_transactions',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('answers 502 and writes nothing when the provider is unreachable', async () => {
    const isolated = await build({ OIDC_ISSUER_URL: 'http://127.0.0.1:9/realms/gone' });
    try {
      const response = await isolated.inject({ method: 'GET', url: '/api/auth/login' });
      expect(response.statusCode).toBe(502);
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      await isolated.close();
    }
  });
});

describe('session fixation', () => {
  evidenceTest('an attacker-chosen cookie never becomes the session', async () => {
    const who = await person();
    const planted = randomSecret();
    const { response, token } = await signIn(who, `__Host-moin_sid=${planted}`);
    expect(response.statusCode).toBe(302);
    expect(token).toBeDefined();
    expect(token).not.toBe(planted);
    expect(await sessions().resolve(planted)).toBeUndefined();
    expect(await sessions().resolve(token)).toBeDefined();
  });

  evidenceTest('signing in again revokes the session the browser held', async () => {
    const who = await person();
    const first = await signIn(who);
    const second = await signIn(who, `__Host-moin_sid=${first.token ?? ''}`);
    expect(second.token).not.toBe(first.token);
    expect(await sessions().resolve(first.token)).toBeUndefined();
    expect(await sessions().resolve(second.token)).toBeDefined();
  });
});

describe('the session primitives behind the cookie', () => {
  evidenceTest(
    'rotation leaves the predecessor unusable and keeps the absolute expiry',
    async () => {
      const who = await person();
      const { token } = await signIn(who);
      const before = await sessions().resolve(token);
      clock.advance(60_000);
      const rotated = await sessions().rotate(token, 'privilege_change');
      expect(rotated?.sessionToken).not.toBe(token);
      expect(await sessions().resolve(token)).toBeUndefined();
      const after = await sessions().resolve(rotated?.sessionToken);
      expect(after?.userId).toBe(who.id);
      expect(after?.absoluteExpiresAt).toStrictEqual(before?.absoluteExpiresAt);
      expect(await sessions().rotate(token, 'step_up')).toBeUndefined();
    },
  );

  evidenceTest('revocation is immediate', async () => {
    const who = await person();
    const { token } = await signIn(who);
    expect(await sessions().revoke(token)).toBe(true);
    expect(await sessions().resolve(token)).toBeUndefined();
  });
});

describe('logging', () => {
  evidenceTest('never writes a sign-in secret or the person behind it', async () => {
    const who = await person();
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    Object.defineProperty(process.stdout, 'write', {
      configurable: true,
      writable: true,
      value: (chunk: string | Uint8Array): boolean => {
        lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    });
    // pino binds its destination when the logger is built, so the application under capture is
    // built inside the window.
    const shared = app;
    const secrets: (string | undefined)[] = [];
    try {
      app = await build();
      const ok = await signIn(who);
      provider.claims = { nonce: randomSecret() };
      const failed = await signIn(who);
      const issued = provider.responses.slice(-2);
      secrets.push(
        ok.token,
        ok.state,
        ok.code,
        ok.started.binding,
        failed.state,
        failed.code,
        new URL(ok.started.location).searchParams.get('nonce') ?? undefined,
        ...issued.flatMap((set) => [set.idToken, set.accessToken, set.refreshToken]),
        'local-development-only',
        who.email,
        who.subject,
      );
      await app.close();
    } finally {
      app = shared;
      Object.defineProperty(process.stdout, 'write', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
    const output = lines.join('');
    expect(output).toContain('signed in');
    expect(output).toContain('sign-in refused');
    expect(secrets.length).toBeGreaterThan(10);
    for (const secret of secrets) {
      expect(secret).toBeDefined();
      expect(output).not.toContain(secret);
    }
  });
});
