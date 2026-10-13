/**
 * Call session state machine (P11.05.01, INV-06/19).
 *
 * States: ringing → active → wrapping → closed. Timeouts: 8 s of silence
 * reprompts once, then the call wraps; the total duration cap ends it.
 * Every transition is a pure function of (state, event) — the property test
 * enumerates the matrix, so an unhandled pair is a failing test, not a
 * dropped call. No interaction ends without an outcome or an open task:
 * `closed` always carries one.
 */

export type CallState = 'ringing' | 'active' | 'wrapping' | 'closed';

export type CallEvent =
  | { readonly kind: 'answered' }
  | { readonly kind: 'slot-confirmed' }
  | { readonly kind: 'silence-timeout' }
  | { readonly kind: 'duration-cap' }
  | { readonly kind: 'wrap-complete' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'hung-up' };

export type CallOutcome =
  | { readonly outcome: 'completed' }
  | { readonly outcome: 'callback-task' }
  | { readonly outcome: 'failed' };

/** Silence before a reprompt (P11.05.01: 8 s, once). */
export const SILENCE_TIMEOUT_MS = 8_000;

export interface CallMachine {
  readonly state: CallState;
  readonly reprompted: boolean;
  readonly outcome: CallOutcome | null;
}

export function initialCall(): CallMachine {
  return { state: 'ringing', reprompted: false, outcome: null };
}

function ring(machine: CallMachine, event: CallEvent): CallMachine {
  if (event.kind === 'answered') return { ...machine, state: 'active' };
  if (event.kind === 'failed') {
    return { ...machine, state: 'closed', outcome: { outcome: 'failed' } };
  }
  if (event.kind === 'hung-up') {
    return { ...machine, state: 'closed', outcome: { outcome: 'callback-task' } };
  }
  return machine;
}

function act(machine: CallMachine, event: CallEvent): CallMachine {
  if (event.kind === 'slot-confirmed') return machine;
  if (event.kind === 'silence-timeout') {
    if (!machine.reprompted) return { ...machine, reprompted: true };
    return { ...machine, state: 'wrapping', outcome: { outcome: 'callback-task' } };
  }
  if (event.kind === 'duration-cap' || event.kind === 'failed') {
    return { ...machine, state: 'closed', outcome: { outcome: 'failed' } };
  }
  if (event.kind === 'hung-up') {
    return { ...machine, state: 'wrapping', outcome: { outcome: 'callback-task' } };
  }
  return machine;
}

function wrap(machine: CallMachine, event: CallEvent): CallMachine {
  if (event.kind === 'wrap-complete') {
    return {
      ...machine,
      state: 'closed',
      outcome: machine.outcome ?? { outcome: 'completed' },
    };
  }
  if (event.kind === 'failed') {
    return { ...machine, state: 'closed', outcome: { outcome: 'failed' } };
  }
  return machine;
}

/**
 * One transition. Returns the next machine; `closed` is terminal (further
 * events are no-ops, never backwards motion). The checkpoint writer runs on
 * `slot-confirmed` and on entry to `closed` — the caller, not this module.
 */
export function transition(machine: CallMachine, event: CallEvent): CallMachine {
  if (machine.state === 'closed') return machine;
  if (machine.state === 'ringing') return ring(machine, event);
  if (machine.state === 'active') return act(machine, event);
  return wrap(machine, event);
}

/**
 * Process loss mid-call (P11.05.03): the finaliser builds a callback task
 * from the last checkpoint — the machine's outcome if it has one, else a
 * callback task. Pure, so the reconciler test needs no database.
 */
export function recoverFromCheckpoint(outcome: CallOutcome | null): CallOutcome {
  return outcome ?? { outcome: 'callback-task' };
}
