/**
 * Subprocessor and region register (P16.08.01/.04, engineering half): rows
 * with purpose, data, region, transfer mechanism and DPA status, plus the
 * EU-region allowlist check. EXT-27 DPA signatures stay WAITING_FOR_EXTERNAL
 * (founder/counsel); DG-14 alternative-provider selection rides separately.
 */

export type DpaStatus = 'signed' | 'pending' | 'missing';

export interface Subprocessor {
  readonly name: string;
  readonly purpose: string;
  readonly region: string;
  readonly transferMechanism: string;
  readonly dpa: DpaStatus;
}

/** EU allowlist: regions the register may hold (EU/EEA only). */
const EU_REGION_PREFIXES: readonly string[] = ['eu-', 'EU-'];

/** True when the region is EU/EEA-resident. */
export function regionAllowed(region: string): boolean {
  return EU_REGION_PREFIXES.some((prefix) => region.startsWith(prefix));
}

/** True when the row is complete: every field present, region enforced. */
export function registerEntryValid(entry: Subprocessor): boolean {
  if (entry.name.trim().length === 0) return false;
  if (entry.purpose.trim().length === 0) return false;
  if (!regionAllowed(entry.region)) return false;
  if (entry.transferMechanism.trim().length === 0) return false;
  return true;
}

/** True when every registered subprocessor holds a signed DPA (EXT-27). */
export function registerDpaComplete(entries: readonly Subprocessor[]): boolean {
  if (entries.length === 0) return false;
  return entries.every((entry) => entry.dpa === 'signed');
}
