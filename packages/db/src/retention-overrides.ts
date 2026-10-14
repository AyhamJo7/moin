/**
 * Tenant retention overrides (P16.02.01/.03): per-tenant days within legal
 * floors — overrides never drop below the statutory floor. Pure validation;
 * the settings hooks and audit ride separately.
 */
import { RETENTION_RULES, type RetentionClass } from './retention.ts';

/** Legal floor per class: the statutory minimum, never undercut. */
export function retentionFloor(retentionClass: RetentionClass): number {
  return RETENTION_RULES[retentionClass].retentionDays;
}

/** Validate a tenant override: finite, integer, at or above the floor. */
export function overrideValid(retentionClass: RetentionClass, days: number): boolean {
  if (!Number.isInteger(days)) return false;
  return days >= retentionFloor(retentionClass);
}

/** Resolve the effective days: override when valid, default otherwise. */
export function effectiveDays(retentionClass: RetentionClass, override: number | null): number {
  if (override !== null && overrideValid(retentionClass, override)) return override;
  return retentionFloor(retentionClass);
}
