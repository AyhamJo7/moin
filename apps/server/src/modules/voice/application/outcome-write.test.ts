/**
 * Outcome writing (P12.12.03, INV-06/11): one outcome per call, rows
 * recorded, duplicates collapse.
 */
import { describe, expect, it } from 'vitest';
import { createOutcomeWriter } from './outcome-write.ts';

describe('outcome writing', () => {
  it('writes handled and needs-attention outcomes with their rows', () => {
    const writer = createOutcomeWriter();
    expect(writer.write('CA1', 'handled-automatically', ['task'])).toStrictEqual({
      callSid: 'CA1',
      kind: 'handled-automatically',
      rows: ['task'],
    });
    expect(writer.write('CA2', 'needs-attention', ['lead', 'request'])).toStrictEqual({
      callSid: 'CA2',
      kind: 'needs-attention',
      rows: ['lead', 'request'],
    });
  });

  it('duplicate end events collapse to the first outcome (INV-11)', () => {
    const writer = createOutcomeWriter();
    expect(writer.write('CA1', 'handled-automatically', [])).not.toBeNull();
    expect(writer.write('CA1', 'handled-automatically', [])).toBeNull();
    expect(writer.write('CA1', 'needs-attention', ['task'])).toBeNull();
  });
});
