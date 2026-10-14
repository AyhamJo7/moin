/**
 * Audited ops CLI guard (P15.07.02): every mutating op requires a reason and
 * records an audit event. Pure gate; the CLI commands and the audit writer
 * ride separately.
 */

export type OpsCommand =
  | 'tenant.status'
  | 'call.timeline'
  | 'jobs.dlq.list'
  | 'jobs.dlq.replay'
  | 'flags.set'
  | 'support.grant.check';

/** Mutating commands: reason + audit event required. */
const MUTATING: ReadonlySet<OpsCommand> = new Set(['jobs.dlq.replay', 'flags.set']);

export interface OpsAudit {
  readonly command: OpsCommand;
  readonly reason: string | null;
  readonly audited: boolean;
}

/** True when the op may run: mutating ops need a non-empty reason. */
export function opsAllowed(command: OpsCommand, reason: string | null): boolean {
  if (!MUTATING.has(command)) return true;
  return reason !== null && reason.trim().length > 0;
}

/** Build the audit record: mutating ops carry the reason. */
export function opsAudit(command: OpsCommand, reason: string | null): OpsAudit {
  return { command, reason: MUTATING.has(command) ? reason : null, audited: true };
}
