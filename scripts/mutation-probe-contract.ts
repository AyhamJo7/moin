/**
 * The contract between the in-process assertion probe and the mutation reporter (P06.10.07).
 *
 * Side-effect free on purpose. The probe registers Vitest hooks at module load, so it can only be
 * imported inside a test process; the reporter runs in the main process and must not pull those
 * registrations in. Both import the shape from here instead.
 */

/** Bumped when `AssertionProbe` changes, so a stale probe cannot be read as a current one. */
export const PROBE_VERSION = 1;

/** The key the probe writes on `task.meta` and the reporter reads. */
export const PROBE_META_KEY = 'moinAssertionProbe';

export interface AssertionProbe {
  readonly version: number;
  /**
   * `expect()` calls made during the test, read from Vitest's own counter in-process.
   *
   * A thrown object cannot increment this, which is what makes it worth recording: zero calls means
   * no assertion can have failed, however the error is decorated.
   */
  readonly expectCalls: number;
  /** Errors recorded against the test when the probe ran. */
  readonly recordedErrors: number;
}
