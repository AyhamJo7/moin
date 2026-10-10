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
  return money(Math.round(euros * 100));
}
