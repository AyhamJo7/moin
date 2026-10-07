import { evidenceTest } from '@moin/testing';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, configKeys, describeConfig, loadConfig, secretKeys } from './env.ts';

const VALID = {
  SERVER_ROLE: 'api',
  DATABASE_URL: 'postgres://moin_app:s3cr3t-p4ssw0rd@localhost:5432/moin',
  APP_ORIGIN: 'http://localhost:3000',
} satisfies NodeJS.ProcessEnv;

const OIDC = {
  OIDC_PROVIDER: 'keycloak',
  OIDC_ISSUER_URL: 'http://127.0.0.1:8080/realms/moin-local',
  OIDC_CLIENT_ID: 'moin-web',
  OIDC_CLIENT_SECRET: 'local-development-only',
  OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback',
} satisfies NodeJS.ProcessEnv;

describe('configuration loader (P02.03.03)', () => {
  it('selects the local OIDC contract and redacts its client secret', () => {
    const config = loadConfig({ ...VALID, ...OIDC });
    expect(config.OIDC_PROVIDER).toBe('keycloak');
    expect(describeConfig(config)['OIDC_CLIENT_SECRET']).toBe('[redacted]');
    expect(describeConfig(config)['OIDC_ISSUER_URL']).toBe('[redacted]');
  });

  it('rejects partial OIDC settings and keeps secrets out of errors', () => {
    const raw = 'private-client-secret';
    try {
      loadConfig({ ...VALID, OIDC_PROVIDER: 'keycloak', OIDC_CLIENT_SECRET: raw });
      expect.unreachable('partial OIDC config must fail');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('OIDC_ISSUER_URL');
      expect(message).not.toContain(raw);
    }
  });

  it('keeps the local provider out of staging and production', () => {
    for (const environment of ['staging', 'production']) {
      expect(() => loadConfig({ ...VALID, ...OIDC, NODE_ENV: environment })).toThrow(
        ConfigurationError,
      );
    }
  });

  it('requires HTTPS for Cognito and redirects outside local development', () => {
    expect(() =>
      loadConfig({
        ...VALID,
        ...OIDC,
        OIDC_PROVIDER: 'cognito',
        OIDC_ISSUER_URL: 'http://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool',
      }),
    ).toThrow(ConfigurationError);
    const config = loadConfig({
      ...VALID,
      ...OIDC,
      APP_ORIGIN: 'https://app.example.de',
      NODE_ENV: 'production',
      OIDC_PROVIDER: 'cognito',
      OIDC_ISSUER_URL: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool',
      OIDC_REDIRECT_URI: 'https://app.example.de/api/auth/callback',
    });
    expect(config.OIDC_PROVIDER).toBe('cognito');
  });

  it('rejects a remote local issuer or callback that can receive an authorization code', () => {
    expect(() =>
      loadConfig({
        ...VALID,
        ...OIDC,
        OIDC_ISSUER_URL: 'http://attacker.example/realms/moin-local',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...VALID,
        ...OIDC,
        OIDC_ISSUER_URL: 'http://127.0.0.1:8080/realms/moin-local?next=other',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...VALID,
        ...OIDC,
        OIDC_REDIRECT_URI: 'http://attacker.example/api/auth/callback',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...VALID,
        ...OIDC,
        OIDC_REDIRECT_URI: 'http://localhost:3000/api/auth/callback?next=https://attacker.example',
      }),
    ).toThrow(ConfigurationError);
  });
  it('applies defaults and returns a frozen object', () => {
    const config = loadConfig(VALID);
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SHUTDOWN_GRACE_MS).toBe(15_000);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('fails fast when a required variable is missing, naming the variable', () => {
    expect(() => loadConfig({ SERVER_ROLE: 'api' })).toThrow(ConfigurationError);
    try {
      loadConfig({ SERVER_ROLE: 'api' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).problems.join()).toContain('DATABASE_URL');
    }
  });

  // P04.04.03. A voice process that starts without these cannot validate a Twilio signature, and
  // the pressure at that point is always to skip validation rather than to fix the environment.
  it('refuses to start the voice role without the values signature validation needs', () => {
    try {
      loadConfig({ ...VALID, SERVER_ROLE: 'voice' });
      expect.unreachable('expected the voice role to require its telephony configuration');
    } catch (error) {
      const problems = (error as ConfigurationError).problems.join('\n');
      expect(problems).toContain('TWILIO_AUTH_TOKEN');
      expect(problems).toContain('VOICE_PUBLIC_ORIGIN');
      expect(problems).toContain('VOICE_WEBSOCKET_ORIGIN');
    }
  });

  it('requires APP_ORIGIN for the api role and accepts a bare origin', () => {
    try {
      loadConfig({ ...VALID, SERVER_ROLE: 'api', APP_ORIGIN: undefined });
      expect.unreachable('expected the api role to require its CSRF origin');
    } catch (error) {
      expect((error as ConfigurationError).problems.join('\n')).toContain('APP_ORIGIN');
    }
    expect(
      loadConfig({ ...VALID, SERVER_ROLE: 'api', APP_ORIGIN: 'https://app.example.de' }).APP_ORIGIN,
    ).toBe('https://app.example.de');
    expect(
      loadConfig({ ...VALID, SERVER_ROLE: 'api', APP_ORIGIN: 'http://localhost:3000' }).APP_ORIGIN,
    ).toBe('http://localhost:3000');
  });

  it('normalises APP_ORIGIN so equivalent spellings compare equal', () => {
    // The review finding: `https://app.example.de/` passed validation (pathname `/`) but never
    // equals a browser `Origin` (`https://app.example.de`), 403ing every mutation. The loader
    // stores `URL.origin`, so both spellings — plus case and default-port variants — land equal.
    for (const spelling of [
      'https://app.example.de',
      'https://app.example.de/',
      'HTTPS://APP.EXAMPLE.DE',
      'https://app.example.de:443',
    ]) {
      expect(loadConfig({ ...VALID, SERVER_ROLE: 'api', APP_ORIGIN: spelling }).APP_ORIGIN).toBe(
        'https://app.example.de',
      );
    }
    expect(
      loadConfig({ ...VALID, SERVER_ROLE: 'api', APP_ORIGIN: 'http://localhost:3000/' }).APP_ORIGIN,
    ).toBe('http://localhost:3000');
  });

  it('refuses an APP_ORIGIN with a path, and non-HTTPS outside dev/test', () => {
    for (const origin of ['https://app.example.de/cb', 'https://app.example.de/?x=1']) {
      expect(() => loadConfig({ ...VALID, SERVER_ROLE: 'api', APP_ORIGIN: origin })).toThrow(
        ConfigurationError,
      );
    }
    expect(() =>
      loadConfig({
        ...VALID,
        SERVER_ROLE: 'api',
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://app.example.de',
      }),
    ).toThrow(ConfigurationError);
    expect(() =>
      loadConfig({
        ...VALID,
        SERVER_ROLE: 'worker',
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://app.example.de',
      }),
    ).toThrow(ConfigurationError);
  });

  it('starts the voice role when its telephony configuration is complete', () => {
    const config = loadConfig({
      ...VALID,
      SERVER_ROLE: 'voice',
      TWILIO_AUTH_TOKEN: 'a'.repeat(32),
      VOICE_PUBLIC_ORIGIN: 'https://voice.example.de',
      VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
    });
    expect(config.SERVER_ROLE).toBe('voice');
  });

  it('does not require telephony configuration for the other roles', () => {
    for (const role of ['api', 'worker', 'migrate'] as const) {
      expect(loadConfig({ ...VALID, SERVER_ROLE: role }).SERVER_ROLE).toBe(role);
    }
  });

  it.each([
    ['a non-https public origin', { VOICE_PUBLIC_ORIGIN: 'http://voice.example.de' }],
    ['a non-wss websocket origin', { VOICE_WEBSOCKET_ORIGIN: 'ws://voice.example.de' }],
  ])('rejects %s', (_name, overrides) => {
    expect(() =>
      loadConfig({
        ...VALID,
        SERVER_ROLE: 'voice',
        TWILIO_AUTH_TOKEN: 'a'.repeat(32),
        VOICE_PUBLIC_ORIGIN: 'https://voice.example.de',
        VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
        ...overrides,
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects an unknown server role rather than starting the wrong module graph', () => {
    expect(() => loadConfig({ ...VALID, SERVER_ROLE: 'api-v2' })).toThrow(ConfigurationError);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...VALID, PORT: '70000' })).toThrow(ConfigurationError);
  });

  it('rejects an image digest that is not a sha256 digest (INV-17)', () => {
    expect(() => loadConfig({ ...VALID, IMAGE_DIGEST: 'latest' })).toThrow(ConfigurationError);
    expect(loadConfig({ ...VALID, IMAGE_DIGEST: `sha256:${'a'.repeat(64)}` }).IMAGE_DIGEST).toBe(
      `sha256:${'a'.repeat(64)}`,
    );
  });

  // INV-15. This is the assertion that matters most in this file.
  it('never puts a rejected secret value into the error', () => {
    const password = 'sup3r-s3cret-pa55word';
    try {
      loadConfig({ SERVER_ROLE: 'api', DATABASE_URL: `not-a-url://user:${password}@host/db` });
      expect.unreachable('expected the loader to reject a malformed DATABASE_URL');
    } catch (error) {
      const rendered = `${(error as Error).message}\n${JSON.stringify(
        (error as ConfigurationError).problems,
      )}`;
      expect(rendered).toContain('DATABASE_URL');
      expect(rendered).not.toContain(password);
      expect(rendered).not.toContain('not-a-url');
    }
  });

  it('never puts a secret into the describable configuration', () => {
    const described = describeConfig(loadConfig(VALID));
    expect(described['DATABASE_URL']).toBe('[redacted]');
    expect(described['SERVER_ROLE']).toBe('api');
    expect(JSON.stringify(described)).not.toContain('s3cr3t-p4ssw0rd');
  });

  it('rejects pretty logging outside development, where its transport is not installed', () => {
    expect(() => loadConfig({ ...VALID, LOG_PRETTY: 'true', NODE_ENV: 'production' })).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfig({ ...VALID, LOG_PRETTY: 'true', NODE_ENV: 'staging' })).toThrow(
      ConfigurationError,
    );
    expect(loadConfig({ ...VALID, LOG_PRETTY: 'true', NODE_ENV: 'development' }).LOG_PRETTY).toBe(
      true,
    );
  });

  // A hand-maintained list of secret-bearing keys beside the schema drifts the first time someone
  // adds a key and forgets the other file — and that first miss leaks a credential into the boot
  // log. This asserts the classification is complete rather than remembered.
  it('classifies every configuration key as secret-bearing or not', () => {
    const secrets = secretKeys();
    const unclassified = configKeys().filter(
      (key) => !secrets.has(key) && /(_URL|SECRET|TOKEN|PASSWORD|KEY|ARN)$/i.test(key),
    );
    expect(unclassified, `these keys look secret-bearing but are not marked`).toStrictEqual([]);
  });

  it('every key marked secret is redacted by describeConfig', () => {
    const described = describeConfig(loadConfig(VALID));
    for (const key of secretKeys()) {
      if (key in described) {
        expect(described[key], `${key} must be redacted`).toBe('[redacted]');
      }
    }
  });
});

describe('the identity database credential (P06.06, ADR-0003)', () => {
  const IDENTITY = 'postgres://moin_identity:s3cr3t-identity@localhost:5432/moin';

  it('is accepted for the api role', () => {
    expect(loadConfig({ ...VALID, IDENTITY_DATABASE_URL: IDENTITY }).IDENTITY_DATABASE_URL).toBe(
      IDENTITY,
    );
  });

  evidenceTest('is refused for voice, worker and migrate, so no other process can hold it', () => {
    const voice = {
      TWILIO_AUTH_TOKEN: 'local-development-only',
      VOICE_PUBLIC_ORIGIN: 'https://voice.example.de',
      VOICE_WEBSOCKET_ORIGIN: 'wss://voice.example.de',
    };
    for (const SERVER_ROLE of ['voice', 'worker', 'migrate']) {
      let problems: readonly string[] = [];
      try {
        loadConfig({ ...VALID, ...voice, SERVER_ROLE, IDENTITY_DATABASE_URL: IDENTITY });
      } catch (error) {
        problems = error instanceof ConfigurationError ? error.problems : [];
      }
      expect(
        problems.some((problem) => problem.startsWith('IDENTITY_DATABASE_URL:')),
        SERVER_ROLE,
      ).toBe(true);
      expect(problems.join('\n')).not.toContain('s3cr3t-identity');
    }
  });

  evidenceTest('must connect as moin_identity, never moin_app, the owner or the migrator', () => {
    for (const user of ['moin_app', 'moin_owner', 'moin_migrator']) {
      expect(
        () =>
          loadConfig({
            ...VALID,
            IDENTITY_DATABASE_URL: `postgres://${user}:x@localhost:5432/moin`,
          }),
        user,
      ).toThrow(ConfigurationError);
    }
  });

  evidenceTest('refuses query parameters that would connect as another role', () => {
    for (const query of [
      '?user=moin_migrator',
      '?USER=moin_owner',
      '?options=-c%20role%3Dmoin_owner',
      '?role=moin_app',
    ]) {
      expect(
        () =>
          loadConfig({
            ...VALID,
            IDENTITY_DATABASE_URL: `postgres://moin_identity:x@localhost:5432/moin${query}`,
          }),
        query,
      ).toThrow(ConfigurationError);
    }
    expect(
      loadConfig({
        ...VALID,
        IDENTITY_DATABASE_URL: 'postgres://moin_identity:x@db:5432/moin?sslmode=verify-full',
      }).IDENTITY_DATABASE_URL,
    ).toContain('sslmode=verify-full');
  });

  it('is secret-bearing, so describeConfig never prints it', () => {
    const described = describeConfig(loadConfig({ ...VALID, IDENTITY_DATABASE_URL: IDENTITY }));
    expect(described['IDENTITY_DATABASE_URL']).toBe('[redacted]');
  });
});
