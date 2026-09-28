import { describe, expect, it } from 'vitest';
import { ConfigurationError, describeConfig, loadConfig } from './env.ts';

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
});
