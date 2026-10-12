/** P09.10: legacy grants remain distinct; never implicitly widen approved scope. */
export const KNOWLEDGE_CHANNELS = ['call', 'message', 'voice', 'email', 'web'] as const;

export function checkKnowledgeChannel(channel: string | undefined): void {
  if (channel !== undefined && !KNOWLEDGE_CHANNELS.some((allowed) => allowed === channel)) {
    throw new RangeError('channel must be call, message, voice, email or web');
  }
}

export function checkKnowledgeChannels(channels: readonly string[] | undefined): string[] {
  const list = channels ?? KNOWLEDGE_CHANNELS;
  if (list.length === 0) throw new RangeError('at least one channel required');
  for (const channel of list) {
    if (typeof channel !== 'string') throw new RangeError('channel must be a string');
    checkKnowledgeChannel(channel);
  }
  return [...list];
}
