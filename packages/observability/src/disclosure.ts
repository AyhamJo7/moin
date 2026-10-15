/**
 * AI-Act disclosure evidence and traceability (P16.12.01/.02, engineering
 * half): disclosure records per call (AI-involved flag + disclosure-played
 * proof) and the traceability link call → model/prompt/policy versions.
 * Counsel classification items (P16.09/.10/.11/.14) stay WAITING_FOR_EXTERNAL.
 */

export interface DisclosureRecord {
  readonly callId: string;
  readonly aiInvolved: boolean;
  readonly disclosurePlayed: boolean;
  readonly disclosureVersion: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** True when the disclosure record is complete and consistent. */
export function disclosureRecorded(record: DisclosureRecord): boolean {
  if (!UUID_RE.test(record.callId)) return false;
  if (record.aiInvolved && !record.disclosurePlayed) return false;
  if (record.disclosurePlayed && record.disclosureVersion.trim().length === 0) return false;
  return true;
}

export interface TraceLink {
  readonly callId: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly policyVersion: string;
}

/** True when the trace links the call to all three version pins. */
export function traceLinks(link: TraceLink): boolean {
  if (!UUID_RE.test(link.callId)) return false;
  for (const version of [link.modelVersion, link.promptVersion, link.policyVersion]) {
    if (version.trim().length === 0) return false;
  }
  return true;
}
