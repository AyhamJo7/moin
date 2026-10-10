// @moin/kernel — value objects (E.164 phone, email, PLZ, money, ids), German normalisation, the
// opening-hours engine and the clock. The clock lands in P02.03 because the configuration loader
// and the health endpoints already need it; the value objects and the opening-hours engine are
// P07.

export { systemClock, fixedClock } from './clock.ts';
export type { Clock } from './clock.ts';
export { uuidv7 } from './ids.ts';
export { phoneNumber } from './phone-number.ts';
export type { PhoneNumber, PhoneKind } from './phone-number.ts';
export { emailAddress } from './email-address.ts';
export type { EmailAddress } from './email-address.ts';
export { postalCode } from './postal-code.ts';
export type { PostalCode } from './postal-code.ts';
export { personName } from './person-name.ts';
export type { PersonName } from './person-name.ts';
export { money, moneyFromEuros } from './money.ts';
export type { Money } from './money.ts';
