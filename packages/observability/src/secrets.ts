/**
 * Secrets rotation and break-glass (P17.04, engineering shapes only):
 * rotation-due schedule (30-day DB credentials) plus the break-glass access
 * shape — dual approval, time-boxed, audited. Real rotation and the sealed
 * procedure stay founder-driven; INV-15 (Secrets Manager by ARN) unchanged.
 */

/** DB credential rotation period in days (P17.04.01). */
export const ROTATION_DAYS = 30;

/** True when the secret is due for rotation. */
export function rotationDue(ageDays: number): boolean {
  if (!Number.isFinite(ageDays) || ageDays < 0) throw new RangeError('age must be ≥ 0');
  return ageDays >= ROTATION_DAYS;
}

export interface BreakGlass {
  readonly approvals: number;
  readonly timeBoxMinutes: number;
  readonly audited: boolean;
}

/** True when break-glass may open: dual approval, boxed, audited. */
export function breakGlassAllowed(access: BreakGlass): boolean {
  if (!Number.isInteger(access.approvals) || access.approvals < 0) return false;
  if (!Number.isFinite(access.timeBoxMinutes) || access.timeBoxMinutes <= 0) return false;
  return access.approvals >= 2 && access.audited;
}
