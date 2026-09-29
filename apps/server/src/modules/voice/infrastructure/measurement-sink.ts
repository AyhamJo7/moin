/**
 * Where the feasibility measurements are written (P04.05.03).
 *
 * ## This file holds personal data
 *
 * Each observation contains what a caller said: a name, a telephone number, a postcode. That is
 * exactly the data the product otherwise goes to some trouble not to persist (INV-07) or log
 * (INV-12). It exists here for one reason — fifty scripted calls by volunteers who gave written
 * consent (EXT-20) are the only way to measure German speech accuracy, and an accuracy figure
 * without the transcripts behind it cannot be checked by anyone.
 *
 * So the containment is structural:
 *
 *   - the configuration loader refuses to start with `VOICE_MEASUREMENT_SINK` set outside
 *     development or test, so it cannot be switched on where real callers reach;
 *   - the sink is only provided when that variable is set; otherwise the no-op sink is used and
 *     nothing is written at all;
 *   - the file is line-delimited JSON under a path the operator chose, is not shipped anywhere,
 *     and `docs/voice/feasibility-report.md` records that it is deleted after analysis unless a
 *     volunteer consented to the eval corpus.
 */

import { appendFileSync } from 'node:fs';
import type { MeasurementSink } from '../application/relay-connection.ts';
import type { SessionSummary } from '../application/relay-session.ts';

/**
 * Appends one JSON line per session.
 *
 * Synchronous on purpose: a session ends once, the write is a few hundred bytes, and an async
 * write would have to be awaited by a close path that is already closing. Losing the last session
 * of a test run because the process exited first is the failure this avoids.
 */
export function createFileMeasurementSink(path: string): MeasurementSink {
  return {
    record(summary: SessionSummary): void {
      appendFileSync(path, `${JSON.stringify(summary)}\n`, 'utf8');
    },
  };
}
