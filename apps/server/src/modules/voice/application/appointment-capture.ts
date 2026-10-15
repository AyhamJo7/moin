/**
 * Appointment-request capture (P12 brief slice; INV-06).
 *
 * Caller wants an appointment → slot loop over date + time + party size +
 * contact → confirm with read-back → create the appointment request via the
 * tool guard with the CallSid idempotency key. Missing slots reprompt (max
 * 2 attempts, then callback capture); the guard write rides separately.
 * Pure turn logic, no I/O.
 */

export type AppointmentStep =
  | { readonly step: 'ask'; readonly slot: 'date' | 'time' | 'partySize' | 'contact' }
  | {
      readonly step: 'ready';
      readonly date: string;
      readonly time: string;
      readonly partySize: string;
      readonly contact: string;
    }
  | { readonly step: 'escalate'; readonly reason: 'slots-unfilled' };

export interface AppointmentSlots {
  readonly date?: string;
  readonly time?: string;
  readonly partySize?: string;
  readonly contact?: string;
}

/** Read-back confirmation line (German). */
export function readBackAppointment(date: string, time: string, partySize: string): string {
  return `Ich habe verstanden: ${date} um ${time} für ${partySize}. Ist das korrekt?`;
}

const ORDER: readonly ('date' | 'time' | 'partySize' | 'contact')[] = [
  'date',
  'time',
  'partySize',
  'contact',
];

/** Next missing slot, or the ready request when all four are present. */
export function appointmentTurn(slots: AppointmentSlots, attempts: number): AppointmentStep {
  for (const slot of ORDER) {
    const value = slots[slot];
    if (value === undefined || value.trim() === '') {
      return attempts >= 2 ? { step: 'escalate', reason: 'slots-unfilled' } : { step: 'ask', slot };
    }
  }
  const date = slots.date ?? '';
  const time = slots.time ?? '';
  const partySize = slots.partySize ?? '';
  const contact = slots.contact ?? '';
  return { step: 'ready', date, time, partySize, contact };
}
