import { describe, expect, it } from 'vitest';
import { ConfigurationError, configKeys, describeConfig, loadConfig, secretKeys } from './env.ts';

const VALID = {
  SERVER_ROLE: 'api',
  DATABASE_URL: 'postgres://moin_app:s3cr3t-p4ssw0rd@localhost:5432/moin',
} satisfies NodeJS.ProcessEnv;

describe('configuration loader (P02.03.03)', () => {
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
