/**
 * Turn-log policy (P16.17.01/.02, ADR-0019, engineering half): default keeps
 * no transcripts — only template facts (free-text ≤ 200 chars) and bot
 * utterances as template/card IDs. The optional redacted turn log carries a
 * 7-day TTL and requires documented tenant instruction + EXT-02 approval
 * (DG-13 stays WAITING_FOR_EXTERNAL; default path needs neither).
 */

/** Free-text request field cap (P16.17.01). */
export const FREE_TEXT_MAX = 200;

/** Redacted turn-log TTL in days (P16.17.02). */
export const TURN_LOG_TTL_DAYS = 7;

export interface TurnFields {
  readonly templateFacts: Readonly<Record<string, string>>;
  readonly freeText: string;
  readonly botUtteranceRef: string;
}

/** True when the kept turn fields respect the policy (no transcript). */
export function turnFieldsValid(fields: TurnFields): boolean {
  if (fields.freeText.length > FREE_TEXT_MAX) return false;
  if (fields.botUtteranceRef.trim().length === 0) return false;
  for (const [key, value] of Object.entries(fields.templateFacts)) {
    if (key.length === 0 || value.length > FREE_TEXT_MAX) return false;
  }
  return true;
}

export interface TurnLogOptIn {
  readonly tenantInstruction: boolean;
  readonly ext02Approval: boolean;
}

/** True when the optional redacted log may exist: instruction + approval. */
export function turnLogAllowed(optIn: TurnLogOptIn): boolean {
  return optIn.tenantInstruction && optIn.ext02Approval;
}
