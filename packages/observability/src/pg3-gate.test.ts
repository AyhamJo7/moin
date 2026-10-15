/**
 * PG-3 gate (P18.12): aggregates + all-met (honest: NOT_READY on live ledger).
 */
import { describe, expect, it } from 'vitest';
import { gateGaps, pg3Gate } from './pg3-gate.ts';

describe('pg-3 readiness gate', () => {
  it('aggregates every input: READY only when all met', () => {
    expect(
      pg3Gate({
        pilotSectionsVerified: true,
        lgChecksMet: true,
        externalsSatisfied: true,
        founderSigned: true,
      }),
    ).toBe('READY');
    expect(
      pg3Gate({
        pilotSectionsVerified: false,
        lgChecksMet: true,
        externalsSatisfied: true,
        founderSigned: true,
      }),
    ).toBe('NOT_READY');
  });

  it('audits gaps: live ledger reports NOT_READY with names', () => {
    expect(
      gateGaps({
        pilotSectionsVerified: false,
        lgChecksMet: false,
        externalsSatisfied: false,
        founderSigned: false,
      }),
    ).toEqual(['pilotSectionsVerified', 'lgChecksMet', 'externalsSatisfied', 'founderSigned']);
    expect(
      gateGaps({
        pilotSectionsVerified: true,
        lgChecksMet: true,
        externalsSatisfied: true,
        founderSigned: true,
      }),
    ).toEqual([]);
  });
});
