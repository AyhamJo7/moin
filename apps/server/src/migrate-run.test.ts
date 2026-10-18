import { describe, expect, it, vi } from 'vitest';
import { EXIT_MIGRATION_FAILED, EXIT_OK, runMigrations } from './migrate-run.ts';

function logger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('the migrate role', () => {
  it('runs the migrations against the given connection and exits 0 only after they resolved', async () => {
    const log = logger();
    const migrate = vi
      .fn()
      .mockResolvedValue({ applied: ['0078_x', '0079_y'], alreadyApplied: 77 });
    expect(await runMigrations('postgres://migrator@db/moin', migrate, log)).toBe(EXIT_OK);
    expect(migrate).toHaveBeenCalledExactlyOnceWith('postgres://migrator@db/moin');
    expect(log.info).toHaveBeenCalledWith(
      { outcome: 'applied', count: 2 },
      'migration run complete',
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('exits 1 when a migration fails, and never reports success', async () => {
    const log = logger();
    const failure = Object.assign(
      new Error('password authentication failed for postgres://u:secret@db'),
      {
        code: '28P01',
      },
    );
    expect(
      await runMigrations('postgres://u:secret@db/moin', vi.fn().mockRejectedValue(failure), log),
    ).toBe(EXIT_MIGRATION_FAILED);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      { outcome: 'failed', reason: '28P01' },
      'migration run failed',
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret');
  });

  it('names the error class when there is no SQLSTATE, and survives a non-error rejection', async () => {
    const log = logger();
    expect(await runMigrations('x', vi.fn().mockRejectedValue(new TypeError('boom')), log)).toBe(1);
    expect(log.error).toHaveBeenLastCalledWith(
      { outcome: 'failed', reason: 'TypeError' },
      'migration run failed',
    );
    expect(await runMigrations('x', vi.fn().mockRejectedValue('text'), log)).toBe(1);
    expect(log.error).toHaveBeenLastCalledWith(
      { outcome: 'failed', reason: 'unknown' },
      'migration run failed',
    );
  });
});
