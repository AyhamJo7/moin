/**
 * Optimistic-locking version conflicts (P07.13.01): the shared 409 problem type.
 *
 * Every P07 writer that mutates a versioned row throws its module's `VersionConflictError`
 * on a stale version or an illegal transition; the HTTP layer maps all of them to this one
 * problem. The `current` field carries the representation the writer must send back so the
 * client can retry against reality instead of guessing: which row, at which version, in
 * which status.
 *
 * Kept in `@moin/db` (not the server) so the contract lives next to the writers that raise
 * it and stays importable without the telemetry stack. The per-module error classes stay —
 * each names its own aggregate in the message — and each gains an `isVersionConflict`
 * narrowing alias via this module, so a controller catches one symbol instead of seven.
 */

export const VERSION_CONFLICT_PROBLEM_TYPE = '/problems/version-conflict';
export const VERSION_CONFLICT_TITLE = 'Version conflict';
export const VERSION_CONFLICT_STATUS = 409;

export interface VersionConflictRepresentation {
  readonly targetKind: string;
  readonly targetId: string;
  readonly version: number;
  readonly status: string;
}

export interface VersionConflictProblem {
  readonly type: typeof VERSION_CONFLICT_PROBLEM_TYPE;
  readonly title: typeof VERSION_CONFLICT_TITLE;
  readonly status: typeof VERSION_CONFLICT_STATUS;
  readonly current: VersionConflictRepresentation;
}

export function versionConflictProblem(
  current: VersionConflictRepresentation,
): VersionConflictProblem {
  return {
    type: VERSION_CONFLICT_PROBLEM_TYPE,
    title: VERSION_CONFLICT_TITLE,
    status: VERSION_CONFLICT_STATUS,
    current,
  };
}

/** Structural narrowing: true for every module's VersionConflictError, whatever it says. */
export function isVersionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === 'VersionConflictError';
}
