/**
 * Production access policy (P17.08.01, engineering shapes): roles with
 * just-in-time elevation — approval + audit + time-box — plus the
 * break-glass link to P17.04. No routine human access to production data:
 * ops CLI (audited) or break-glass only. Network enforcement (VPC, ECS Exec)
 * rides the infrastructure verification (P17.08.03).
 */

export type ProdRole = 'viewer' | 'operator' | 'breakglass';

export interface Elevation {
  readonly role: ProdRole;
  readonly approved: boolean;
  readonly audited: boolean;
  readonly timeBoxMinutes: number;
}

/** True when the elevation may proceed: approved, audited, time-boxed. */
export function elevationAllowed(elevation: Elevation): boolean {
  if (!elevation.approved || !elevation.audited) return false;
  if (!Number.isFinite(elevation.timeBoxMinutes) || elevation.timeBoxMinutes <= 0) return false;
  return true;
}

/** Access paths per role: viewer reads via CLI, operator mutates via CLI, break-glass via P17.04. */
export function accessPath(role: ProdRole): string {
  if (role === 'viewer') return 'ops-cli-read';
  if (role === 'operator') return 'ops-cli-mutate';
  return 'breakglass';
}
