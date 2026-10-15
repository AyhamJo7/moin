/**
 * Account hardening checklist (P17.02.01, engineering shapes only): MFA
 * enforced, no root keys, encrypted volumes, IMDSv2 — plus the GuardDuty /
 * Config finding route to SEV2/SEV3 alarms (P17.02.02 shape). Real console
 * work (CloudTrail org trail, Analyzer, Health) stays founder-driven.
 */

export interface HardeningCheck {
  readonly mfaEnforced: boolean;
  readonly rootKeysAbsent: boolean;
  readonly volumesEncrypted: boolean;
  readonly imdsv2Enforced: boolean;
}

/** True when every hardening requirement holds. */
export function hardeningComplete(check: HardeningCheck): boolean {
  return (
    check.mfaEnforced && check.rootKeysAbsent && check.volumesEncrypted && check.imdsv2Enforced
  );
}

/** Names of the requirements still open. */
export function hardeningOpen(check: HardeningCheck): readonly string[] {
  const open: string[] = [];
  if (!check.mfaEnforced) open.push('mfaEnforced');
  if (!check.rootKeysAbsent) open.push('rootKeysAbsent');
  if (!check.volumesEncrypted) open.push('volumesEncrypted');
  if (!check.imdsv2Enforced) open.push('imdsv2Enforced');
  return open;
}
