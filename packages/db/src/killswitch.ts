/**
 * Kill switch and back-to-normal (P18.09, reusing P08.10 flags): kill engages
 * AI-answering-off (apology + callback capture), back-to-normal restores
 * with the owner guide + remote fallback. Pure shapes; the live rehearsal
 * on the pilot tenant rides the founder drill.
 */

export type KillState = 'normal' | 'killed';

export interface KillSwitch {
  readonly state: KillState;
  readonly apologyPlayed: boolean;
  readonly callbackCaptured: boolean;
}

/** True when the kill engages: AI off, apology + callback capture on. */
export function killEngages(kill: KillSwitch): boolean {
  return kill.state === 'killed' && kill.apologyPlayed && kill.callbackCaptured;
}

export interface BackToNormal {
  readonly forwardingDisabled: boolean;
  readonly ownerGuideShown: boolean;
  readonly remoteDone: boolean;
}

/** True when normal restores: forwarding off via guide or remote. */
export function normalRestores(back: BackToNormal): boolean {
  if (!back.forwardingDisabled) return false;
  return back.ownerGuideShown || back.remoteDone;
}
