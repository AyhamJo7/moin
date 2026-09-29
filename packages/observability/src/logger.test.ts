/**
 * INV-12 regression tests for the logger.
 *
 * These assert on the **serialised line**, not on `redactToAllowlist` in isolation. That
 * distinction is the whole point: `redaction.test.ts` passed while three separate paths carried
 * personal data straight to stdout, because none of them went through the function under test.
 * A privacy control has to be tested where the bytes leave the process.
 */

import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';
import { REDACTED } from './redaction.ts';

const PHONE = '+4915112345678';
const DSN = 'postgres://moin_app:S3cr3tPw@db.internal:5432/moin';

/**
 * Per-line context for the next `captured(...)` call.
 *
 * A module-level variable rather than a parameter so that every existing call site keeps working
 * unchanged, which keeps this addition from touching assertions it has nothing to do with.
 */
let contextForNextCapture: (() => Record<string, unknown>) | undefined;

/** Capture what pino actually writes, by replacing stdout for the duration of `run`. */
function captured(run: (log: ReturnType<typeof createLogger>) => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const original = process.stdout.write.bind(process.stdout);
  Object.defineProperty(process.stdout, 'write', {
    value: (chunk: string | Uint8Array): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
    configurable: true,
    writable: true,
  });
  try {
    run(
      createLogger({
        level: 'trace',
        service: 'moin',
        role: 'api',
        env: 'test',
        ...(contextForNextCapture === undefined ? {} : { context: contextForNextCapture }),
      }),
    );
  } finally {
    Object.defineProperty(process.stdout, 'write', {
      value: original,
      configurable: true,
      writable: true,
    });
    sink.destroy();
  }
  return lines
    .join('')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('logger (INV-12, serialised output)', () => {
  it('passes allowlisted fields through and redacts the rest', () => {
    const [line] = captured((log) => {
      log.info({ requestId: 'req_1', organisationId: 'org_1', callerName: 'Anna' }, 'inbound');
    });
    expect(line?.['requestId']).toBe('req_1');
    expect(line?.['organisationId']).toBe('org_1');
    expect(line?.['callerName']).toBe(REDACTED);
  });

  // pino appends `msg` AFTER formatters.log runs, so an Error first argument used to write
  // err.message verbatim while the err branch dutifully redacted the same string.
  it('never writes an error message into msg', () => {
    const [line] = captured((log) => {
      log.error(new Error(`connect ECONNREFUSED for ${DSN}`));
    });
    const rendered = JSON.stringify(line);
    expect(rendered).not.toContain('S3cr3tPw');
    expect(rendered).not.toContain('ECONNREFUSED for');
    expect(line?.['msg']).toBe('error');
  });

  it('keeps a caller-supplied message when an error is passed with one', () => {
    const [line] = captured((log) => {
      log.error(new Error(`failed for ${PHONE}`), 'could not reach the contact');
    });
    expect(line?.['msg']).toBe('could not reach the contact');
    expect(JSON.stringify(line)).not.toContain(PHONE);
  });

  it('reports the real error class rather than "Object"', () => {
    class ConfigurationError extends Error {
      override readonly name = 'ConfigurationError';
    }
    const [line] = captured((log) => {
      log.error(new ConfigurationError('DATABASE_URL is wrong'));
    });
    expect((line?.['err'] as Record<string, unknown>)['type']).toBe('ConfigurationError');
  });

  // The idiomatic per-request pattern in NestJS, and the one that leaked.
  it('redacts child bindings', () => {
    const [line] = captured((log) => {
      log.child({ phone: PHONE, callerName: 'Anna Schmidt' }).info({ requestId: 'r1' }, 'call');
    });
    const rendered = JSON.stringify(line);
    expect(rendered).not.toContain(PHONE);
    expect(rendered).not.toContain('Anna Schmidt');
    expect(line?.['requestId']).toBe('r1');
  });

  it('redacts grandchild bindings', () => {
    const [line] = captured((log) => {
      log
        .child({ organisationId: 'org_1' })
        .child({ transcript: 'Tisch für vier Personen' })
        .info('nested');
    });
    expect(JSON.stringify(line)).not.toContain('Tisch für vier');
  });

  // A child chain that silently dropped its parent's bindings would make every request-scoped
  // log line lose its correlation, which is the reason child loggers exist.
  it('keeps allowlisted bindings from every level of a child chain', () => {
    const [line] = captured((log) => {
      log.child({ organisationId: 'org_1' }).child({ callId: 'call_9' }).info('nested');
    });
    expect(line?.['organisationId']).toBe('org_1');
    expect(line?.['callId']).toBe('call_9');
  });

  it('redacts the request context carried in AsyncLocalStorage', () => {
    const [line] = captured((log) => {
      log.info({ requestId: 'req_2', contactEmail: 'anna@example.de' }, 'ctx');
    });
    expect(line?.['requestId']).toBe('req_2');
    expect(line?.['contactEmail']).toBe(REDACTED);
  });
});

describe('per-line context (P06.03.06)', () => {
  afterEach(() => {
    contextForNextCapture = undefined;
  });

  it('attaches the tenant of the current unit of work to every line', () => {
    contextForNextCapture = () => ({ organisationId: '11111111-1111-4111-8111-111111111111' });
    const lines = captured((log) => {
      log.info('first');
      log.warn('second');
    });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line['organisationId']).toBe('11111111-1111-4111-8111-111111111111');
    }
  });

  it('adds nothing when there is no unit of work', () => {
    contextForNextCapture = () => ({});
    const [line] = captured((log) => {
      log.info('outside');
    });
    expect(line?.['organisationId']).toBeUndefined();
  });

  // The convenience must not become a way round the allowlist: a caller that returns a phone
  // number from its context function is still redacted (INV-12).
  it('is redacted like anything else', () => {
    contextForNextCapture = () => ({ callerNumber: PHONE, organisationId: 'org-1' });
    const [line] = captured((log) => {
      log.info('with context');
    });
    expect(JSON.stringify(line)).not.toContain(PHONE);
    expect(line?.['callerNumber']).toBe('[redacted]');
    expect(line?.['organisationId']).toBe('org-1');
  });
});
