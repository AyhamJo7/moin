/**
 * German-realistic synthetic test data (P02.05.03).
 *
 * Realistic on purpose, and synthetic without exception (INV-16).
 *
 * **Realistic**, because data that does not look like the real thing hides real bugs: umlauts and
 * ß break naive slugs, sorting and search; German addresses put the house number after the street;
 * PLZ are five digits and can start with a zero, so any code treating one as a number loses it;
 * German phone numbers have variable-length area codes, so "strip the first four digits" is wrong.
 *
 * **Synthetic**, because production data never enters a test. Every phone number here is inside
 * the ranges the Bundesnetzagentur reserves for testing and drama, so a number that escapes a
 * fixture into a real dialler cannot reach a person. Every domain is `.example`, reserved by
 * RFC 2606 and guaranteed unroutable.
 */

/**
 * Deterministic pseudo-random source.
 *
 * Seeded so a failing test can be reproduced from its seed. `Math.random()` would make a factory
 * bug appear in one run out of fifty and never again.
 */
export class Seeded {
  #state: number;

  constructor(seed = 0x2f6e2b1) {
    this.#state = seed >>> 0;
  }

  next(): number {
    // xorshift32 — small, fast, and good enough to vary fixtures.
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state / 0x1_0000_0000;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('cannot pick from an empty list');
    return item;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

const FIRST_NAMES = [
  'Anna',
  'Jonas',
  'Mia',
  'Lukas',
  'Sophie',
  'Felix',
  'Lena',
  'Maximilian',
  'Hannah',
  'Elias',
  'Jürgen',
  'Käthe',
  'Björn',
  'Müsli',
  'Özlem',
  'Sören',
] as const;

const LAST_NAMES = [
  'Müller',
  'Schmidt',
  'Schneider',
  'Fischer',
  'Weber',
  'Meyer',
  'Wagner',
  'Becker',
  'Schulz',
  'Hoffmann',
  'Groß',
  'Weiß',
  'Köhler',
  'Schäfer',
  'Yılmaz',
] as const;

const STREETS = [
  'Hauptstraße',
  'Bahnhofstraße',
  'Gartenweg',
  'Lindenallee',
  'Mühlenweg',
  'Am Alten Markt',
  'Rosenstraße',
  'Kirchplatz',
  'Elbchaussee',
  'Große Bergstraße',
] as const;

/** Real German cities with a genuine PLZ, including one that starts with a zero. */
const CITIES = [
  { city: 'Hamburg', postalCode: '20095' },
  { city: 'Hamburg', postalCode: '22765' },
  { city: 'Leipzig', postalCode: '04109' },
  { city: 'Dresden', postalCode: '01067' },
  { city: 'München', postalCode: '80331' },
  { city: 'Köln', postalCode: '50667' },
] as const;

export interface GermanPerson {
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

/**
 * A German mobile number inside the Bundesnetzagentur test range.
 *
 * 015 7x xxxxxxx is allocated for testing and can never be assigned to a subscriber, so a number
 * from here cannot reach a person even if a fixture escapes into a real dialler.
 */
export function testPhoneNumber(random: Seeded): string {
  const subscriber = String(random.int(0, 9_999_999)).padStart(7, '0');
  return `+49157${String(random.int(0, 9))}${subscriber}`;
}

/** A landline in the 032 range, which is non-geographic and reserved for this purpose. */
export function testLandlineNumber(random: Seeded): string {
  return `+49321${String(random.int(0, 99_999_999)).padStart(8, '0')}`;
}

export function germanPerson(random: Seeded = new Seeded()): GermanPerson {
  const firstName = random.pick(FIRST_NAMES);
  const lastName = random.pick(LAST_NAMES);
  const place = random.pick(CITIES);
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    // .example is reserved by RFC 2606 and cannot be registered, so mail to it goes nowhere.
    email: `${asciiFold(firstName)}.${asciiFold(lastName)}@example.example`,
    phone: testPhoneNumber(random),
    street: `${random.pick(STREETS)} ${String(random.int(1, 199))}`,
    postalCode: place.postalCode,
    city: place.city,
  };
}

/**
 * Fold German characters the way a person would when typing an email address.
 *
 * Deliberately not `normalize('NFD')` + strip: that turns ü into u, but German convention is ue,
 * and ß becomes ss rather than disappearing. Getting this wrong produces addresses that look
 * plausible and match nothing.
 */
export function asciiFold(value: string): string {
  let folded = value;
  for (const [from, to] of FOLDING) folded = folded.replaceAll(from, to);
  return folded
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Characters that must be replaced before NFD, because NFD does not decompose them.
 *
 * The German pairs encode convention rather than shape: ü becomes ue, not u, and ß becomes ss.
 *
 * The rest are letters carrying no combining mark, so NFD leaves them intact and the
 * `[^a-z0-9]` strip then deletes them outright. Turkish dotless ı is the one that matters most
 * here — Turkish surnames are common in Germany, and folding "Yılmaz" to "ylmaz" produces an
 * address that looks plausible and matches nothing.
 */
const FOLDING: readonly (readonly [string, string])[] = [
  ['ä', 'ae'],
  ['ö', 'oe'],
  ['ü', 'ue'],
  ['Ä', 'Ae'],
  ['Ö', 'Oe'],
  ['Ü', 'Ue'],
  ['ß', 'ss'],
  ['ẞ', 'Ss'],
  ['ı', 'i'],
  ['İ', 'I'],
  ['ł', 'l'],
  ['Ł', 'L'],
  ['đ', 'd'],
  ['Đ', 'D'],
  ['ø', 'oe'],
  ['Ø', 'Oe'],
  ['æ', 'ae'],
  ['Æ', 'Ae'],
  ['œ', 'oe'],
  ['Œ', 'Oe'],
  ['ð', 'd'],
  ['Ð', 'D'],
  ['þ', 'th'],
  ['Þ', 'Th'],
];
