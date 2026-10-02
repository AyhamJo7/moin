/**
 * A sweep that stops inside its mutant window, so a real signal can be sent to it (P06.10.07).
 *
 * `mutation-sweep-isolation.test.ts` runs this as its own Node process against a throwaway
 * repository: the baseline passes, the mutant is written, the marker file appears, and the
 * observation never returns. The test then sends `SIGINT` or `SIGTERM` and checks what is on disk.
 *
 *   node signal-driver.ts <root> <marker> <variants-json>
 */
import { writeFileSync } from 'node:fs';
import { installSignalRestoration, runSweep, type Variant } from '../../mutation-sweep.ts';

const [root = '', marker = '', variantsJson = '[]'] = process.argv.slice(2);
const variants = JSON.parse(variantsJson) as Variant[];

installSignalRestoration();
await runSweep(variants, variants.slice(0, 1), {
  root,
  observe: async (_variant, phase) => {
    if (phase === 'baseline') {
      return {
        classification: { outcome: 'SURVIVED', detail: 'passed', matched: 1, unrelatedFailures: 0 },
        durationMs: 0,
      };
    }
    writeFileSync(marker, 'mutant applied');
    return new Promise(() => {
      // Never settles, and keeps the process alive until a signal arrives.
      setInterval(() => undefined, 60_000);
    });
  },
});
