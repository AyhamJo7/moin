/**
 * A real sweep whose observer can be held at named points (P06.10.07).
 *
 * `mutation-sweep-lock.test.ts` starts several of these as separate Node processes against one
 * throwaway repository, to reproduce two sweeps overlapping in one worktree. The orchestration is the
 * production `runSweep`. Only Vitest is replaced: the observer records, for every run it is asked
 * for, **the bytes of the target on disk at the moment the test would have executed**, which is
 * exactly what "the test ran against its own mutant" means.
 *
 *   node paused-driver.ts <root> <name> <control-dir> <variants-json> <selected-ids> [<pauses>]
 *
 * `<pauses>` is a comma-separated list of `phase:variantId`. At each, the driver writes
 * `<name>.<phase>.<id>.paused` into the control directory and waits for `<name>.<phase>.<id>.go`.
 * Every observation is appended to `<name>.log` as one JSON line; the outcome goes to
 * `<name>.done.json`.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  installSignalRestoration,
  runSweep,
  SourceIntegrityError,
  type Variant,
} from '../../mutation-sweep.ts';

const POLL_MS = 10;

const [root = '', name = '', control = '', variantsJson = '[]', selectedIds = '', pauses = ''] =
  process.argv.slice(2);
const variants = JSON.parse(variantsJson) as Variant[];
const ids = selectedIds.split(',').filter((id) => id.length > 0);
const selected = variants.filter((variant) => ids.includes(variant.id));
const holds = new Set(pauses.split(',').filter((hold) => hold.length > 0));

async function hold(point: string): Promise<void> {
  if (!holds.has(point)) return;
  const marker = point.replace(':', '.');
  writeFileSync(join(control, `${name}.${marker}.paused`), String(process.pid));
  while (!existsSync(join(control, `${name}.${marker}.go`))) {
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
}

function record(entry: Record<string, unknown>): void {
  appendFileSync(join(control, `${name}.log`), `${JSON.stringify(entry)}\n`);
}

installSignalRestoration();
try {
  const results = await runSweep(variants, selected, {
    root,
    observe: async (variant, phase) => {
      const point = `${phase}:${variant.id}`;
      record({ event: 'enter', point });
      await hold(point);
      // What a test started now would execute against.
      record({ event: 'observed', point, content: readFileSync(join(root, variant.file), 'utf8') });
      return {
        classification:
          phase === 'baseline'
            ? { outcome: 'SURVIVED', detail: 'passed', matched: 1, unrelatedFailures: 0 }
            : { outcome: 'KILLED_ASSERTION', detail: 'killed', matched: 1, unrelatedFailures: 0 },
        durationMs: 0,
      };
    },
  });
  writeFileSync(
    join(control, `${name}.done.json`),
    JSON.stringify({ status: 'ok', outcomes: results.map((result) => result.outcome) }),
  );
} catch (error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  writeFileSync(
    join(control, `${name}.done.json`),
    JSON.stringify({ status: 'error', name: failure.name, message: failure.message }),
  );
  process.exitCode =
    failure instanceof SourceIntegrityError ? 3 : failure.name === 'SweepLockError' ? 4 : 1;
}
