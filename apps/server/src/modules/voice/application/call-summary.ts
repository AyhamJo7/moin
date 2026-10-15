/**
 * Structured call summary, async (P12.13 brief slice; INV-08).
 *
 * After the call: NLU structures the turn notes into a Draft summary
 * record — outcome, topics, follow-ups. The summary is never served as
 * knowledge (no retrieval path reads it); it is owner-facing only. Pure
 * shape here; the NLU call and the Draft write ride separately.
 */

export interface SummaryDraft {
  readonly callSid: string;
  readonly outcome: string;
  readonly topics: readonly string[];
  readonly followUps: readonly string[];
  /** Summaries are drafts, never knowledge — no retrieval path may read them. */
  readonly servableAsKnowledge: false;
}

/** Build the draft from structured NLU fields; empty topics allowed. */
export function draftSummary(
  callSid: string,
  outcome: string,
  topics: readonly string[],
  followUps: readonly string[],
): SummaryDraft {
  return {
    callSid,
    outcome,
    topics: [...topics],
    followUps: [...followUps],
    servableAsKnowledge: false,
  };
}
