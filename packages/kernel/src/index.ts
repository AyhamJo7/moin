// @moin/kernel — value objects (E.164 phone, email, PLZ, money, ids), German normalisation, the
// opening-hours engine and the clock. The clock lands in P02.03 because the configuration loader
// and the health endpoints already need it; the value objects and the opening-hours engine are
// P07.

export { systemClock, fixedClock } from './clock.ts';
export type { Clock } from './clock.ts';
export { uuidv7 } from './ids.ts';
