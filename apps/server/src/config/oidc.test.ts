/** P06.05.04: one OIDC provider per environment, chosen by configuration and checked at boot. */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { inspect } from 'node:util';
import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, OIDC_PROVIDER_BY_ENVIRONMENT, loadConfig } from './env.ts';
import { resolveOidcConfig } from './oidc.ts';

const BASE = {
  SERVER_ROLE: 'api',
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgres://moin_app:s3cr3t-p4ssw0rd@localhost:5432/moin',
} satisfies NodeJS.ProcessEnv;

const KEYCLOAK = {
  OIDC_PROVIDER: 'keycloak',
  OIDC_ISSUER_URL: 'http://127.0.0.1:8080/realms/moin-local',
  OIDC_CLIENT_ID: 'moin-web',
  OIDC_CLIENT_SECRET: 'local-development-only',
  OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
} satisfies NodeJS.ProcessEnv;

const COGNITO = {
  OIDC_PROVIDER: 'cognito',
  OIDC_ISSUER_URL: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Example12',
  OIDC_CLIENT_ID: '1example23456789abcdefghij',
  OIDC_CLIENT_SECRET: 'cognito-client-secret-value',
  OIDC_REDIRECT_URI: 'https://app.example.de/api/auth/callback',
} satisfies NodeJS.ProcessEnv;

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;

function resolveFor(env: NodeJS.ProcessEnv) {
  return resolveOidcConfig(loadConfig({ ...BASE, ...env }));
}

function problemsFor(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig({ ...BASE, ...env });
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    return (error as ConfigurationError).problems;
  }
  return expect.unreachable('configuration must be rejected');
}

describe('the OIDC provider switch', () => {
  it('maps every environment to exactly one provider', () => {
    expect(OIDC_PROVIDER_BY_ENVIRONMENT).toStrictEqual({
      development: 'keycloak',
      test: 'keycloak',
      staging: 'cognito',
      production: 'cognito',
    });
  });

  it.each(['development', 'test'] as const)('resolves the local provider in %s', (NODE_ENV) => {
    const oidc = resolveFor({ ...KEYCLOAK, NODE_ENV });
    expect(oidc).toMatchObject({
      provider: 'keycloak',
      issuer: KEYCLOAK.OIDC_ISSUER_URL,
      clientId: 'moin-web',
      redirectUri: KEYCLOAK.OIDC_REDIRECT_URI,
      scopes: ['openid', 'email'],
    });
    expect(oidc.clientSecret.reveal()).toBe(KEYCLOAK.OIDC_CLIENT_SECRET);
  });

  it.each(['staging', 'production'] as const)('resolves Cognito in %s', (NODE_ENV) => {
    const oidc = resolveFor({ ...COGNITO, NODE_ENV });
    expect(oidc).toMatchObject({
      provider: 'cognito',
      issuer: COGNITO.OIDC_ISSUER_URL,
      clientId: COGNITO.OIDC_CLIENT_ID,
      redirectUri: COGNITO.OIDC_REDIRECT_URI,
      scopes: ['openid', 'email'],
    });
    expect(oidc.clientSecret.reveal()).toBe(COGNITO.OIDC_CLIENT_SECRET);
  });

  it('gives both providers the same configuration shape', () => {
    const local = resolveFor({ ...KEYCLOAK, NODE_ENV: 'development' });
    const deployed = resolveFor({ ...COGNITO, NODE_ENV: 'production' });
    expect(Object.keys(local).sort()).toStrictEqual(Object.keys(deployed).sort());
    expect(local.scopes).toStrictEqual(deployed.scopes);
  });

  it.each(['staging', 'production'] as const)('refuses the local provider in %s', (NODE_ENV) => {
    // Even with a Cognito-shaped issuer and an HTTPS callback: the provider itself is wrong.
    const problems = problemsFor({ ...COGNITO, OIDC_PROVIDER: 'keycloak', NODE_ENV });
    expect(problems.join(' ')).toContain('OIDC_PROVIDER');
    expect(() => resolveFor({ ...KEYCLOAK, NODE_ENV })).toThrow(ConfigurationError);
  });

  evidenceTest('refuses the local provider in staging even with deployable settings', () => {
    // Loopback issuer and an HTTPS callback: nothing but the provider choice is wrong.
    expect(() =>
      loadConfig({
        ...BASE,
        ...KEYCLOAK,
        NODE_ENV: 'staging',
        OIDC_REDIRECT_URI: 'https://localhost/api/auth/callback',
      }),
    ).toThrow(/OIDC_PROVIDER: local provider is not allowed outside development or test/);
  });

  evidenceTest('refuses a valid Cognito configuration in development', () => {
    expect(() => loadConfig({ ...BASE, ...COGNITO, NODE_ENV: 'development' })).toThrow(
      /OIDC_PROVIDER: development and test use the local provider/,
    );
  });

  evidenceTest('refuses Cognito with a loopback HTTPS issuer', () => {
    expect(() =>
      loadConfig({
        ...BASE,
        ...COGNITO,
        NODE_ENV: 'production',
        OIDC_ISSUER_URL: 'https://localhost/eu-central-1_Example12',
      }),
    ).toThrow(/OIDC_ISSUER_URL/);
  });

  evidenceTest('refuses partial Cognito settings instead of ignoring them', () => {
    const partial = Object.fromEntries(
      Object.entries(COGNITO).filter(([key]) => key !== 'OIDC_CLIENT_SECRET'),
    );
    expect(() => loadConfig({ ...BASE, ...partial, NODE_ENV: 'production' })).toThrow(
      /OIDC_CLIENT_SECRET/,
    );
  });

  it.each(['development', 'test'] as const)('refuses Cognito in %s', (NODE_ENV) => {
    const problems = problemsFor({ ...COGNITO, NODE_ENV });
    expect(problems).toContain(
      'OIDC_PROVIDER: development and test use the local provider, never a deployed user pool',
    );
  });

  it('accepts exactly one provider per environment across the whole matrix', () => {
    const accepted: string[] = [];
    for (const NODE_ENV of ENVIRONMENTS) {
      for (const [name, provider] of [
        ['keycloak', KEYCLOAK],
        ['cognito', COGNITO],
      ] as const) {
        try {
          resolveFor({ ...provider, NODE_ENV });
          accepted.push(`${NODE_ENV}:${name}`);
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigurationError);
        }
      }
    }
    expect(accepted).toStrictEqual([
      'development:keycloak',
      'test:keycloak',
      'staging:cognito',
      'production:cognito',
    ]);
  });

  it.each([
    ['a loopback issuer', 'https://localhost/eu-central-1_Example12'],
    ['a Keycloak issuer', 'https://127.0.0.1:8080/realms/moin-local'],
    ['plain HTTP', 'http://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Example12'],
    ['a region outside the EU', 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example12'],
    [
      'a pool from another region',
      'https://cognito-idp.eu-central-1.amazonaws.com/eu-west-1_Example12',
    ],
    ['a look-alike host', 'https://cognito-idp.eu-central-1.amazonaws.com.attacker.example/x_1'],
    ['a trailing slash', 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_Example12/'],
    ['no pool', 'https://cognito-idp.eu-central-1.amazonaws.com/'],
  ])('refuses Cognito with %s as issuer', (_label, OIDC_ISSUER_URL) => {
    const problems = problemsFor({ ...COGNITO, NODE_ENV: 'production', OIDC_ISSUER_URL });
    expect(problems.join(' ')).toContain('OIDC_ISSUER_URL');
  });

  it('refuses the local provider with a Cognito issuer', () => {
    const problems = problemsFor({
      ...KEYCLOAK,
      OIDC_ISSUER_URL: COGNITO.OIDC_ISSUER_URL,
    });
    expect(problems).toContain('OIDC_ISSUER_URL: is set but is not valid');
  });

  it.each(Object.keys(COGNITO))('refuses Cognito settings without %s', (missing) => {
    const partial = Object.fromEntries(
      Object.entries({ ...COGNITO, NODE_ENV: 'production' }).filter(([key]) => key !== missing),
    );
    expect(problemsFor(partial).join(' ')).toContain(missing);
  });

  it('refuses a provider that is neither of the two', () => {
    expect(problemsFor({ ...COGNITO, OIDC_PROVIDER: 'auth0', NODE_ENV: 'production' }).length).toBe(
      1,
    );
  });

  it('fails closed when sign-in asks for OIDC and none is configured', () => {
    for (const NODE_ENV of ENVIRONMENTS) {
      expect(() => resolveOidcConfig(loadConfig({ ...BASE, NODE_ENV }))).toThrow(
        ConfigurationError,
      );
    }
  });
});

describe('the client secret boundary', () => {
  evidenceTest('cannot be printed from the resolved configuration', () => {
    const oidc = resolveFor({ ...COGNITO, NODE_ENV: 'production' });
    const secret = COGNITO.OIDC_CLIENT_SECRET;
    expect(JSON.stringify(oidc)).not.toContain(secret);
    expect(inspect(oidc, { depth: 10, showHidden: true })).not.toContain(secret);
    expect(String(oidc.clientSecret)).not.toContain(secret);
    expect(Object.isFrozen(oidc)).toBe(true);
  });

  it('is not read or exposed anywhere a browser bundle is built from', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const browserSources = [join(root, 'apps/web'), join(root, 'packages')];
    const offenders: string[] = [];
    let scanned = 0;
    for (const dir of browserSources) {
      for (const file of sourceFiles(dir)) {
        scanned += 1;
        const text = readFileSync(file, 'utf8');
        if (/OIDC_|config\/oidc|config\/env/.test(text)) {
          offenders.push(relative(root, file));
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(offenders).toStrictEqual([]);
    // Next.js inlines only NEXT_PUBLIC_* variables into client code.
    const example = readFileSync(join(root, '.env.example'), 'utf8');
    expect(example).not.toMatch(/^\s*#?\s*NEXT_PUBLIC_[A-Z_]*(OIDC|SECRET|CLIENT)/m);
  });
});

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Tests and lint fixtures are never bundled; the boundary rule's own fixture imports env.ts.
    if (
      ['node_modules', 'dist', '.next', '.turbo', 'coverage', '__fixtures__'].includes(entry.name)
    ) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}
