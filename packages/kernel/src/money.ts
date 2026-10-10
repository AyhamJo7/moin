/**
 * Money in EUR cents (P07.01.02).
 *
 * Integer cents, never floats: `0.1 + 0.2` is the bug this type exists to prevent. Non-EUR
 * currencies arrive in P23 billing; until then the currency is a constant, not a field, so no
 * mixed-currency arithmetic can exist yet. Amounts must be whole cents within ±10M EUR.
 */

const MAX_CENTS = 1_000_000_000;

export interface Money {
  readonly cents: number;
  add(other: Money): Money;
  formatDe(): string;
}

function check(cents: number): void {
  if (!Number.isInteger(cents) || Math.abs(cents) > MAX_CENTS) {
    throw new RangeError('amount must be whole cents within ±10M EUR');
  }
}

export function money(cents: number): Money {
  check(cents);
  return {
    cents,
    add(other: Money): Money {
      const sum = this.cents + other.cents;
      check(sum);
      return money(sum);
    },
    formatDe(): string {
      return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: 'EUR',
      }).format(this.cents / 100);
    },
  };
}

export function moneyFromEuros(euros: number): Money {
  // Decimal-string conversion: binary floats cannot represent most cent values (1.005 is stored
  // as 1.0049999…, so euros * 100 rounds the wrong way). Split the decimal spelling instead —
  // half cents round up, which is the documented rounding for this boundary.
  if (!Number.isFinite(euros)) throw new RangeError('amount must be a finite number of euros');
  const text = String(Math.abs(euros));
  const [whole = '0', frac = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  const halfUp = (frac + '000')[2] !== undefined && Number((frac + '000')[2]) >= 5;
  const total = cents + (halfUp ? 1 : 0);
  return money(euros < 0 ? -total : total);
}
