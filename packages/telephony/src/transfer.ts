/**
 * Transfer and handoff (P11.10.01/.02 [G:LAUNCH]): warm transfer with
 * context handoff + cold transfer fallback + transfer-target validation
 * (verified German numbers; never the forwarding source line; never the
 * called number — loop prevention P11.10.04). The live Dial flow and the
 * no-answer reconnect ride the telephony wiring separately.
 */

/** E.164 German number shape. */
const DE_E164 = /^\+49\d{6,14}$/;

/** True when the target is a verified German number. */
export function targetValid(target: string): boolean {
  return DE_E164.test(target.trim());
}

export interface TransferTargets {
  readonly sourceLine: string;
  readonly calledNumber: string;
  readonly target: string;
  readonly verified: boolean;
}

/** Validate the target: verified, not the source line, not the called number. */
export function handoffValid(targets: TransferTargets): boolean {
  if (!targets.verified) return false;
  if (!targetValid(targets.target)) return false;
  if (targets.target === targets.sourceLine) return false;
  if (targets.target === targets.calledNumber) return false;
  return true;
}

export type TransferMode = 'warm-context' | 'cold-fallback';

/** Resolve the mode: warm with context, cold fallback without. */
export function transferMode(hasContext: boolean): TransferMode {
  return hasContext ? 'warm-context' : 'cold-fallback';
}
