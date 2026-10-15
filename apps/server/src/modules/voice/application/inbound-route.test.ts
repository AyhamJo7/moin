/**
 * Inbound routing (P11.01.01/.03/.04): active routes through, quarantined /
 * unknown / malformed to the neutral message; the metric counts, the number
 * never reaches logs or labels. Synthetic numbers only (INV-16).
 */
import { describe, expect, it, vi } from 'vitest';
import { isRoutableE164, routeInboundCall, UNASSIGNED_NUMBER_METRIC } from './inbound-route.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const LOC = '22222222-2222-4222-8222-222222222222';

function ports(rows: readonly { organisationId: string; locationId: string }[]) {
  return {
    resolveRoute: vi.fn(() => Promise.resolve(rows)),
    countUnassigned: vi.fn(),
  };
}

describe('inbound routing', () => {
  it('routes an active number to its tenant and location', async () => {
    const p = ports([{ organisationId: ORG, locationId: LOC }]);
    const decision = await routeInboundCall('+493012345601', p);
    expect(decision).toStrictEqual({ routed: true, organisationId: ORG, locationId: LOC });
    expect(p.resolveRoute).toHaveBeenCalledOnce();
    expect(p.countUnassigned).not.toHaveBeenCalled();
  });

  it('answers quarantined/unknown with the neutral message + metric, never a tenant', async () => {
    for (const rows of [[], []] as const) {
      const p = ports(rows);
      const decision = await routeInboundCall('+493012345602', p);
      expect(decision).toMatchObject({ routed: false });
      if (!decision.routed) {
        expect(decision.twiml).toContain('Diese Rufnummer ist derzeit nicht vergeben.');
        expect(decision.twiml).not.toContain('ConversationRelay');
      }
      expect(p.countUnassigned).toHaveBeenCalledOnce();
    }
    expect(UNASSIGNED_NUMBER_METRIC).toBe('voice.unassigned_number');
  });

  it('rejects malformed numbers before the DB call', async () => {
    expect(isRoutableE164('0049301234')).toBe(false);
    expect(isRoutableE164('+49')).toBe(false);
    const p = ports([{ organisationId: ORG, locationId: LOC }]);
    await routeInboundCall('0049301234', p);
    expect(p.resolveRoute).not.toHaveBeenCalled();
    expect(p.countUnassigned).toHaveBeenCalledOnce();
  });
});
