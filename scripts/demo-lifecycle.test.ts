import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `deploy/demo/demo.sh` lifecycle decisions (M2D-2, review finding F1), tested with fake `docker`,
 * `ss`, `curl` and `python3` so no container, port or demo data is involved. The checks live in the
 * shell test because they drive the script through its command line; this runs them in the unit gate.
 */
describe('demo.sh lifecycle', () => {
  it('discovers, starts, restarts and resets the demo without needing its token or rotating it', () => {
    const result = spawnSync(
      'bash',
      [resolve(import.meta.dirname, '../deploy/demo/tests/lifecycle.test.sh')],
      {
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(result.stdout + result.stderr).toMatch(/demo lifecycle: (\d+) of \1 checks passed/u);
    expect(result.status).toBe(0);
  });
});
