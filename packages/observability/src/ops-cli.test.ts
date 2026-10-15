/**
 * Audited ops CLI (P15.07.02): reason-required + audit-recorded.
 */
import { describe, expect, it } from 'vitest';
import { opsAllowed, opsAudit } from './ops-cli.ts';

describe('audited ops CLI', () => {
  it('requires a reason for mutating ops only', () => {
    expect(opsAllowed('flags.set', null)).toBe(false);
    expect(opsAllowed('flags.set', '  ')).toBe(false);
    expect(opsAllowed('flags.set', 'disable noisy flag')).toBe(true);
    expect(opsAllowed('jobs.dlq.replay', 'drain after deploy')).toBe(true);
    expect(opsAllowed('tenant.status', null)).toBe(true);
    expect(opsAllowed('call.timeline', null)).toBe(true);
  });

  it('records the audit event with the reason on mutating ops', () => {
    expect(opsAudit('flags.set', 'disable noisy flag')).toEqual({
      command: 'flags.set',
      reason: 'disable noisy flag',
      audited: true,
    });
    expect(opsAudit('tenant.status', null).audited).toBe(true);
  });
});
