/**
 * Production account and environment guard (P17.01, engineering shapes only):
 * prod shape (account + environment + guardrails) and the env guard that
 * blocks prod writes outside prod. Real provisioning (P05/EXT-09 cloud items)
 * stays WAITING_FOR_EXTERNAL — founder-driven.
 */

export type Environment = 'dev' | 'staging' | 'prod';

export interface ProdShape {
  readonly account: string;
  readonly environment: Environment;
  readonly multiAz: boolean;
  readonly alarmsEnabled: boolean;
}

/** True when the shape is a guarded production environment. */
export function prodShapeValid(shape: ProdShape): boolean {
  if (shape.account.trim().length === 0) return false;
  if (shape.environment !== 'prod') return false;
  return shape.multiAz && shape.alarmsEnabled;
}

/** True when a prod write may proceed: only in prod, never in dev. */
export function prodWriteAllowed(environment: Environment): boolean {
  return environment === 'prod';
}
