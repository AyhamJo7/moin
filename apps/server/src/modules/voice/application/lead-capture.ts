/**
 * Lead capture (P12.08.01, filed per mapping under the lead slice; INV-06).
 *
 * Caller expresses interest → slot loop over name + need + contact →
 * create the lead via the tool guard with the CallSid idempotency key.
 * Missing slots reprompt (max 2 attempts, then callback capture); the
 * guard write rides separately. Pure turn logic, no I/O.
 */

export type LeadStep =
  | { readonly step: 'ask'; readonly slot: 'name' | 'need' | 'contact' }
  | {
      readonly step: 'ready';
      readonly name: string;
      readonly need: string;
      readonly contact: string;
    }
  | { readonly step: 'escalate'; readonly reason: 'slots-unfilled' };

export interface LeadSlots {
  readonly name?: string;
  readonly need?: string;
  readonly contact?: string;
}

const ORDER: readonly ('name' | 'need' | 'contact')[] = ['name', 'need', 'contact'];

/** Next missing slot, or the ready lead when all three are present. */
export function leadTurn(slots: LeadSlots, attempts: number): LeadStep {
  for (const slot of ORDER) {
    const value = slots[slot];
    if (value === undefined || value.trim() === '') {
      return attempts >= 2 ? { step: 'escalate', reason: 'slots-unfilled' } : { step: 'ask', slot };
    }
  }
  const name = slots.name ?? '';
  const need = slots.need ?? '';
  const contact = slots.contact ?? '';
  return { step: 'ready', name, need, contact };
}
