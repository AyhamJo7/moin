/**
 * Retention engine (P16.01.01/.03/.04): per-class rules with statutory holds
 * and legal-hold bypass. `retentionDue` is the pure decision — expired and
 * unheld fires, held items are kept. Dry-run equals actual by construction:
 * both call this function. No cross-tenant effects: the runner scopes per
 * tenant (R-38).
 */

export type RetentionClass = 'notifications' | 'deliveries' | 'escalations' | 'billing' | 'audit';

export interface RetentionRule {
  readonly retentionDays: number;
  readonly statutoryHold: boolean;
}

export const RETENTION_RULES: Readonly<Record<RetentionClass, RetentionRule>> = {
  notifications: { retentionDays: 90, statutoryHold: false },
  deliveries: { retentionDays: 90, statutoryHold: false },
  escalations: { retentionDays: 90, statutoryHold: false },
  billing: { retentionDays: 2_920, statutoryHold: true },
  audit: { retentionDays: 365, statutoryHold: true },
};

/** True when the item is expired, unheld, and its class may auto-purge. */
export function retentionDue(
  retentionClass: RetentionClass,
  ageDays: number,
  legalHold: boolean,
): boolean {
  if (!Number.isFinite(ageDays) || ageDays < 0) throw new RangeError('age must be ≥ 0');
  const rule = RETENTION_RULES[retentionClass];
  if (rule.statutoryHold) return false;
  if (legalHold) return false;
  return ageDays > rule.retentionDays;
}
