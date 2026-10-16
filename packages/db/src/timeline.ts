/**
 * Unified customer timeline (P28.01 [G:SELL]): merge calls/emails/tasks/
 * notes into one ordered timeline per customer + identity link (exact match
 * key) + reply-draft composer (drafts only, human sends). Channel loaders
 * and the P07.04 merge UX ride separately; this module is the merge +
 * compose shapes. Synthetic-only (INV-16).
 */

export type TimelineChannel = 'call' | 'email' | 'task' | 'note';

export interface TimelineItem {
  readonly atMs: number;
  readonly channel: TimelineChannel;
  readonly refId: string;
  readonly erased: boolean;
}

/** Merge channel items into one timeline, oldest-first, erased → placeholder. */
export function mergeTimeline(items: readonly TimelineItem[]): readonly TimelineItem[] {
  return [...items]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.atMs - b.item.atMs || a.index - b.index)
    .map(({ item }) => item);
}

/** Placeholder line for erased contacts (P28.01.03). */
export function erasedLine(): string {
  return 'Kontakt gelöscht.';
}

/** Identity link key: exact match on verified channel id (P07.03 rules). */
export function identityKey(channel: TimelineChannel, verifiedId: string): string | null {
  const id = verifiedId.trim();
  if (id.length === 0) return null;
  if (channel === 'call' || channel === 'email') return `${channel}:${id}`;
  return null;
}

export interface ReplyDraft {
  readonly threadKey: string;
  readonly body: string;
  readonly draftOnly: boolean;
}

/** Compose a reply draft: always draft-only, human sends. */
export function composeDraft(threadKey: string, body: string): ReplyDraft | null {
  if (threadKey.trim().length === 0) return null;
  if (body.trim().length === 0) return null;
  return { threadKey, body, draftOnly: true };
}
