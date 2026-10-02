import { Module } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrExit } from './bootstrap.ts';
import { ConfigurationError } from './config/env.ts';

const REFUSED = Symbol('REFUSED');

@Module({
  providers: [
    {
      provide: REFUSED,
      useFactory: () => {
        throw new ConfigurationError(['provider-token encryption: KMS data key not built']);
      },
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a Nest module is a decorated empty class by design.
class RefusingModule {}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('building the application', () => {
  it('turns a module that refuses its configuration into one clean line and exit 1', async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    const nestErrors: unknown[] = [];
    const logger = {
      log: () => undefined,
      warn: () => undefined,
      error: (...args: unknown[]) => nestErrors.push(args),
    };

    await expect(createOrExit(RefusingModule, logger)).rejects.toThrow('process.exit');
    // Nest reported the failure through the logger it was given, not as raw text.
    expect(nestErrors.length).toBeGreaterThan(0);
    expect(exit).toHaveBeenCalledWith(1);
    const output = written.join('');
    expect(output).toContain('KMS data key not built');
    expect(output).toContain('No value is shown above on purpose');
    expect(output).not.toMatch(/\n\s+at /);
  });
});
