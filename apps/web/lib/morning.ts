/**
 * Morning summary banner (P13.09.01): first open after opening time shows
 * the overnight breakdown — handled, needs attention, back office — with
 * the same fields the digest email (P14.06) carries so the automated
 * comparison (P13.09.03) can run on shapes. Pure builder; the loaders and
 * the digest comparison ride separately.
 */

export interface MorningDigest {
  readonly handled: number;
  readonly needsAttention: number;
  readonly backOffice: number;
}

export interface MorningSummary extends MorningDigest {
  readonly total: number;
  readonly line: string;
}

/** Build the banner: total = handled, attention and back-office stay visible. */
export function buildMorningSummary(digest: MorningDigest): MorningSummary {
  const total = digest.handled + digest.needsAttention + digest.backOffice;
  return {
    ...digest,
    total,
    line: `Guten Morgen. Seit Ladenschluss wurden ${total} Kontakte bearbeitet.`,
  };
}

/** Sections present: the banner shows the breakdown only when there is one. */
export function hasBreakdown(summary: MorningSummary): boolean {
  return summary.total > 0;
}
