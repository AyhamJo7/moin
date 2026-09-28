/**
 * Time as a dependency.
 *
 * Opening hours, reminder windows, slot holds, token expiry and retention all branch on "now".
 * If "now" is `Date.now()`, none of that is testable without sleeping, and the tests that do get
 * written become the flaky ones that get quarantined. A `Clock` makes the branch explicit and
 * lets a test put the system at 23:59 on a German public holiday without waiting for one.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/** A clock a test controls. Advancing it is explicit, so a test can never "wait" by accident. */
export function fixedClock(
  start: Date,
): Clock & { advance(ms: number): void; set(at: Date): void } {
  let current = new Date(start.getTime());
  return {
    now(): Date {
      return new Date(current.getTime());
    },
    advance(ms: number): void {
      current = new Date(current.getTime() + ms);
    },
    set(at: Date): void {
      current = new Date(at.getTime());
    },
  };
}
