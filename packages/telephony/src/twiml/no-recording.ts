/**
 * No-recording verification (P11.14.01, INV-07).
 *
 * Recording is permanently off: no `<Record>`, no `record` attributes, no
 * recording or transcription-storage features in any TwiML we emit. This
 * module is the lint: `assertNoRecording` fails any TwiML containing a
 * recording construct, and the builder tests call it on every emitted
 * document. The weekly Twilio-recordings job (P11.14.02) and the retention
 * confirmation (P11.14.03) ride separately — this is the code-side half.
 */

const RECORDING = /<\s*record[\s>/]|[\s]record\s*=/i;

/** True when the TwiML contains no recording construct. */
export function hasNoRecording(twiml: string): boolean {
  return !RECORDING.test(twiml);
}

/** Throws when the TwiML contains a recording construct (INV-07). */
export function assertNoRecording(twiml: string): void {
  if (!hasNoRecording(twiml)) {
    throw new Error('TwiML must not contain recording constructs (INV-07)');
  }
}
