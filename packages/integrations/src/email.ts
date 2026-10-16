/**
 * Email channel shapes (P27 SELL): thread grouping + reply-draft creation.
 * Receive is stubbed (EXT-14/15 OAuth + SES pending founder); the thread
 * logic and draft shapes are real. Replies are drafts only — a human sends
 * (ADR-0030). Synthetic-only (INV-16).
 */

export interface EmailMessage {
  readonly messageId: string;
  readonly threadId: string | null;
  readonly subject: string;
  readonly from: string;
}

/** Normalize a subject: strip Re:/Aw: prefixes, trim, lowercase. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(re|aw|fwd|wg)\s*:\s*/gi, '')
    .replace(/^(re|aw|fwd|wg)\s*:\s*/gi, '')
    .trim()
    .toLowerCase();
}

/** Group messages into threads: by threadId, else by normalized subject. */
export function threadGroups(
  messages: readonly EmailMessage[],
): Readonly<Record<string, readonly EmailMessage[]>> {
  const groups: Record<string, EmailMessage[]> = {};
  for (const message of messages) {
    const key = message.threadId ?? `subject:${normalizeSubject(message.subject)}`;
    (groups[key] ??= []).push(message);
  }
  return groups;
}

export interface ReplyDraft {
  readonly threadKey: string;
  readonly to: string;
  readonly subject: string;
  readonly draftOnly: boolean;
}

/** Create a reply draft: always draft-only, never sent (ADR-0030). */
export function draftReply(message: EmailMessage): ReplyDraft {
  const key = message.threadId ?? `subject:${normalizeSubject(message.subject)}`;
  const subject = message.subject.trim().length > 0 ? message.subject : '(kein Betreff)';
  return { threadKey: key, to: message.from, subject: `Re: ${subject}`, draftOnly: true };
}
