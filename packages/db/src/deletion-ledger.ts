/**
 * Deletion ledger and post-restore replay (P16.07.01/.02): ID-only ledger
 * rows with tombstones, and replay-after-restore applying tombstones since
 * the restore point. Pure; the Object-Lock bucket writer and the ops CLI
 * `replay-deletions` ride separately (P16.07.03 drill in P17.06).
 */

export interface DeletionEntry {
  readonly refKind: string;
  readonly refId: string;
  readonly deletedAtMs: number;
  readonly tombstone: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** True when the ledger row is well-formed: IDs only, opaque tombstone. */
export function ledgerEntryValid(entry: DeletionEntry): boolean {
  const kind = entry.refKind.trim();
  if (kind.length === 0 || kind.length > 80) return false;
  if (!UUID_RE.test(entry.refId)) return false;
  if (!Number.isFinite(entry.deletedAtMs) || entry.deletedAtMs < 0) return false;
  if (entry.tombstone.trim().length === 0 || entry.tombstone.length > 160) return false;
  return true;
}

/** Replay tombstones deleted after the restore point, in ledger order. */
export function replaySince(
  entries: readonly DeletionEntry[],
  restorePointMs: number,
): readonly DeletionEntry[] {
  if (!Number.isFinite(restorePointMs) || restorePointMs < 0) {
    throw new RangeError('restore point must be ≥ 0');
  }
  return entries
    .filter((entry) => entry.deletedAtMs > restorePointMs)
    .sort((a, b) => a.deletedAtMs - b.deletedAtMs);
}
