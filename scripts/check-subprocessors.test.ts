import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverage, internalFlows, parties } from './check-subprocessors.ts';

describe('the subprocessor register (P04.10.04)', () => {
  it('the real register accounts for every flow in the diagram', () => {
    const result = coverage();
    expect(result.unaccountedFlows).toStrictEqual([]);
    expect(result.registeredUnknownFlows).toStrictEqual([]);
    expect(result.partiesWithoutRegion).toStrictEqual([]);
    expect(result.bothProcessedAndInternal).toStrictEqual([]);
    expect(result.parties).toBeGreaterThanOrEqual(5);
  });

  it('reads the parties that actually process data', () => {
    const names = parties().map((p) => p.name);
    expect(names.some((n) => n.startsWith('Twilio'))).toBe(true);
    expect(names.some((n) => n.startsWith('OpenAI'))).toBe(true);
    expect(names.some((n) => n.startsWith('Amazon'))).toBe(true);
  });

  // The status vocabulary table has the same column shape as a party row. If it were read as
  // parties, four fictional providers would appear in the register with no region.
  it('does not mistake the status vocabulary table for a list of parties', () => {
    for (const party of parties()) {
      expect(party.name).not.toBe('NOT_REQUESTED');
      expect(party.name).not.toBe('status');
    }
  });

  it('reads the internal flows as an explicit list, not as an absence', () => {
    expect(internalFlows()).toContain('F1');
    expect(internalFlows()).toContain('F8');
  });
});

function register(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'subproc-'));
  const path = join(dir, 'subprocessors.md');
  writeFileSync(path, body, 'utf8');
  return path;
}

describe('what the check catches', () => {
  // This is the whole point: a provider added later, by someone who did not know this file exists.
  it('fails when a flow is covered by nobody', () => {
    const path = register(
      [
        '| party | role | what | region | DPA | flows |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Twilio | telephony | a | IE1 | `NOT_REQUESTED` | F2 |',
        '',
        '## Flows that stay inside our own systems',
        '',
        '| F1 | caller |',
      ].join('\n'),
    );
    const result = coverage(path);
    expect(result.unaccountedFlows.length).toBeGreaterThan(0);
    expect(result.unaccountedFlows).toContain('F3');
  });

  it('fails when the register cites a flow the diagram does not have', () => {
    const path = register(
      [
        '| party | role | what | region | DPA | flows |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Ghost | none | a | EU | `SIGNED` | F99 |',
        '',
        '## Flows that stay inside our own systems',
        '',
      ].join('\n'),
    );
    expect(coverage(path).registeredUnknownFlows).toContain('F99');
  });

  it('fails a party with no processing region', () => {
    const path = register(
      [
        '| party | role | what | region | DPA | flows |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Somewhere | model | a | — | `REQUESTED` | F3 |',
        '',
        '## Flows that stay inside our own systems',
        '',
      ].join('\n'),
    );
    expect(coverage(path).partiesWithoutRegion).toStrictEqual(['Somewhere']);
  });

  it('fails a flow claimed as both processed and internal', () => {
    const path = register(
      [
        '| party | role | what | region | DPA | flows |',
        '| --- | --- | --- | --- | --- | --- |',
        '| Twilio | telephony | a | IE1 | `NOT_REQUESTED` | F2 |',
        '',
        '## Flows that stay inside our own systems',
        '',
        '| F2 | allegedly internal |',
      ].join('\n'),
    );
    expect(coverage(path).bothProcessedAndInternal).toStrictEqual(['F2']);
  });
});
