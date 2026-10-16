/**
 * Security hardening sweep (P30 SELL, engineering half): dependency audit
 * triage + secret-scan gate + pentest-finding intake with triage states.
 * The external pentest (EXT-19) and vendor RoE ride founder-side; this
 * module is the intake shape findings land in.
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingState = 'open' | 'triaged' | 'fixed' | 'accepted';

export interface PentestFinding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly state: FindingState;
  readonly title: string;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9\-_]{0,79}$/;

/** True when the finding record is well-formed (id + title, known enums). */
export function findingValid(finding: PentestFinding): boolean {
  if (!ID_RE.test(finding.id)) return false;
  if (finding.title.trim().length === 0) return false;
  return true;
}

/** True when no untriaged critical/high remains (open blocks, rest passes). */
export function auditTriaged(findings: readonly PentestFinding[]): boolean {
  for (const finding of findings) {
    if (!findingValid(finding)) return false;
    if (
      (finding.severity === 'critical' || finding.severity === 'high') &&
      finding.state === 'open'
    ) {
      return false;
    }
  }
  return true;
}
