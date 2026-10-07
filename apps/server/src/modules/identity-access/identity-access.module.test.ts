import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { systemClock } from '@moin/kernel';
import type { IdentityStore } from '@moin/db';
import { evidenceTest } from '@moin/testing';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../../config/config.module.ts';
import { ConfigurationError, loadConfig } from '../../config/env.ts';
import { buildSignInGate } from './identity-access.module.ts';
import { AuthController } from './http/auth.controller.ts';
import { SessionMembershipGuard } from './http/session-membership.guard.ts';
import { REQUEST_CONTEXTS, SESSIONS, SIGN_IN } from './identity-access.tokens.ts';
import { LOGGER } from '../../observability/logger.module.ts';

const store = {} as IdentityStore;
const logger = { info: vi.fn(), warn: vi.fn() } as never;

const LOCAL = {
  NODE_ENV: 'test',
  SERVER_ROLE: 'api',
  DATABASE_URL: 'postgres://moin_app:x@localhost:5432/moin',
  OIDC_PROVIDER: 'keycloak',
  OIDC_ISSUER_URL: 'http://127.0.0.1:8080/realms/moin-local',
  OIDC_CLIENT_ID: 'moin-web',
  OIDC_CLIENT_SECRET: 'local-development-only',
  OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
  AUTH_LOCAL_TOKEN_KEY: 'local-v1:local-development-only',
  IDENTITY_DATABASE_URL: 'postgres://moin_identity:x@localhost:5432/moin',
  APP_ORIGIN: 'http://localhost:3000',
};

function without(source: Record<string, string>, ...keys: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

const DEPLOYED = {
  SERVER_ROLE: 'api',
  DATABASE_URL: 'postgres://moin_app:x@db.internal:5432/moin',
  OIDC_PROVIDER: 'cognito',
  OIDC_ISSUER_URL: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Example12',
  OIDC_CLIENT_ID: 'client',
  OIDC_CLIENT_SECRET: 'resolved-from-secrets-manager',
  OIDC_REDIRECT_URI: 'https://app.example.de/api/auth/callback',
  APP_ORIGIN: 'https://app.example.de',
};

describe('building sign-in', () => {
  it('builds for a complete local configuration', () => {
    expect(buildSignInGate(loadConfig(LOCAL), store, systemClock, logger).service).toBeDefined();
  });

  it('is absent, not half-built, when no OIDC client is configured', () => {
    const rest = without(
      LOCAL,
      'OIDC_PROVIDER',
      'OIDC_ISSUER_URL',
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'OIDC_REDIRECT_URI',
    );
    expect(buildSignInGate(loadConfig(rest), store, systemClock, logger).service).toBeUndefined();
  });

  evidenceTest('refuses to start in staging or production without KMS token custody', () => {
    for (const NODE_ENV of ['staging', 'production']) {
      const config = loadConfig({ ...DEPLOYED, NODE_ENV });
      expect(() => buildSignInGate(config, store, systemClock, logger), NODE_ENV).toThrow(
        ConfigurationError,
      );
    }
  });

  it('refuses a redirect URI that does not name the callback route', () => {
    const config = loadConfig({ ...LOCAL, OIDC_REDIRECT_URI: 'http://localhost:3000/elsewhere' });
    expect(() => buildSignInGate(config, store, systemClock, logger)).toThrow(ConfigurationError);
  });

  evidenceTest('refuses to sign anyone in without the moin_identity pool', () => {
    expect(() => buildSignInGate(loadConfig(LOCAL), null, systemClock, logger)).toThrow(
      /IDENTITY_DATABASE_URL/,
    );
  });

  it('refuses a local configuration without a local token key', () => {
    const rest = without(LOCAL, 'AUTH_LOCAL_TOKEN_KEY');
    expect(() => buildSignInGate(loadConfig(rest), store, systemClock, logger)).toThrow(
      ConfigurationError,
    );
  });
});

describe('the sign-in routes without sign-in', () => {
  it('answer 503 with a problem', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: SIGN_IN, useValue: { service: undefined } },
        { provide: SESSIONS, useValue: null },
        { provide: CONFIG, useValue: loadConfig(LOCAL) },
        SessionMembershipGuard,
        { provide: REQUEST_CONTEXTS, useValue: null },
        { provide: LOGGER, useValue: logger },
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      for (const url of ['/api/auth/login', '/api/auth/callback?state=x&code=y']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(503);
        expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
        expect(JSON.parse(response.body)).toStrictEqual({
          type: '/problems/sign-in-unavailable',
          title: 'Sign-in is unavailable',
          status: 503,
        });
      }
    } finally {
      await app.close();
    }
  });
});
